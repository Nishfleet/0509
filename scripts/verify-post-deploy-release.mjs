#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import {
  checkHealthEndpoint,
  DEFAULT_CANARY_HEALTH_BASE_URLS,
  formatProductionCanaryReport,
  runProductionCanary,
} from "./prod-canary.lib.mjs";
import { fetchPreview } from "./dodo-pricing-canary.mjs";
import {
  runCanary as runBillingCanary,
  validateBillingCanaryResult,
} from "./dodo-billing-canary.mjs";
import { runCanary as runProofCanary } from "./launch-readiness-canary.mjs";
import {
  checkBackupLifecyclePolicy,
  cleanupBackupLifecycleCanary,
  runBackupLifecycleCanary,
} from "./d1-backup-lifecycle-canary.mjs";

const PRICING_COUNTRIES = Object.freeze(["IN", "US", "GB"]);
const GATE_C_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUIRED_PASSED_STEPS = Object.freeze([
  "identity_pre",
  "backup_lifecycle",
  "pricing",
  "billing",
  "proof_email",
  "production_meta",
  "proof_cleanup",
  "identity_post",
]);

/** @typedef {{ runId: string, digestRunId: string, proofCaptureId: string }} CleanupTicket */
/** @typedef {{ runId?: unknown, digestRunId?: unknown, proofCaptureId?: unknown, [key: string]: unknown }} ProofPayload */
/** @typedef {{ ok: boolean, payload?: ProofPayload, report?: unknown, [key: string]: unknown }} GateStepResult */
/**
 * @typedef {{
 *   healthAnchor?: (input: { workerVersionId: string }) => Promise<GateStepResult>,
 *   backupLifecycle?: (input: { workerVersionId: string, runId: string }) => Promise<GateStepResult>,
 *   backupLifecycleRecheck?: (input: { workerVersionId: string, expectedSummary: unknown }) => Promise<GateStepResult>,
 *   backupLifecycleCleanup?: (input: { workerVersionId: string }) => Promise<GateStepResult>,
 *   pricing?: (input: { workerVersionId: string, token: string }) => Promise<GateStepResult>,
 *   billing?: (input: { workerVersionId: string, runId: string, token: string }) => Promise<GateStepResult>,
 *   proof?: (input: { workerVersionId: string, runId: string, token: string }) => Promise<GateStepResult>,
 *   cleanup?: (input: { ticket: CleanupTicket | null, gateRunId: string, token: string }) => Promise<GateStepResult>,
 *   productionCanary?: (input: { workerVersionId: string, token: string }) => Promise<GateStepResult>
 * }} GateDependencies
 */
/**
 * @typedef {{
 *   schemaVersion: number,
 *   generatedAt: string,
 *   workerVersionId: string,
 *   searchRolloutMode: string,
 *   gateRunId: string,
 *   status: string,
 *   steps: Record<string, { status: "started" | "passed", at: string }>,
 *   errors: string[],
 *   cleanupTicket?: CleanupTicket,
 *   productionSummary?: string,
 *   backupLifecycleSummary?: unknown,
 *   proofDiagnostics?: { blockers?: string[], delivery?: { attempts?: number, channels?: string[], details?: Array<{ channel?: string, status?: string, webhookStatus?: string }> } },
 *   completedAt?: string,
 *   ownerPid?: number
 * }} GateJournal
 */

/** @param {string} name */
function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

/** @param {string} path @param {unknown} value */
function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** @param {string} path */
function syncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** @param {string} path @param {GateJournal} journal */
function claimInitialJournal(path, journal) {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(journal, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  syncDirectory(dirname(path));
}

/** @param {string} workerVersionId */
function gateRunId(workerVersionId) {
  const normalized = workerVersionId.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!normalized || normalized.length > 110) throw new Error("worker_version_not_gate_safe");
  return `gate-c-${normalized}`;
}

/** @param {string} step */
function safeStepError(step) {
  return `${step}_failed`;
}

const DIAGNOSTIC_IDENTIFIER_PATTERN = /^[a-z0-9._-]{1,128}$/u;

/**
 * Project a proof canary payload into identifier-safe diagnostics for the
 * journal so a proof_email failure is actionable. The route already sanitizes
 * `delivery` via sanitizeDeliveryForCanary (no recipient addresses, no message
 * bodies, no tokens); this re-projects ONLY identifier-safe fields — blocker
 * identifiers plus delivery statuses/lanes(channels)/webhookStatus — defensively
 * dropping everything else (including timestamps) so nothing address-shaped can
 * ever leak into evidence.
 * @param {ProofPayload | undefined} payload
 */
export function sanitizeProofDiagnostics(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const source = /** @type {Record<string, unknown>} */ (payload);
  /** @type {NonNullable<GateJournal["proofDiagnostics"]>} */
  const diagnostics = {};
  if (Array.isArray(source.blockers)) {
    const blockers = source.blockers.filter(
      (value) =>
        typeof value === "string" && DIAGNOSTIC_IDENTIFIER_PATTERN.test(value),
    );
    if (blockers.length > 0) diagnostics.blockers = blockers;
  }
  const delivery = source.delivery;
  if (delivery && typeof delivery === "object" && !Array.isArray(delivery)) {
    const deliverySource = /** @type {Record<string, unknown>} */ (delivery);
    /** @type {NonNullable<NonNullable<GateJournal["proofDiagnostics"]>["delivery"]>} */
    const summary = {};
    if (Number.isInteger(deliverySource.attempts)) {
      summary.attempts = /** @type {number} */ (deliverySource.attempts);
    }
    if (Array.isArray(deliverySource.channels)) {
      const channels = deliverySource.channels.filter(
        (value) => typeof value === "string",
      );
      if (channels.length > 0) summary.channels = channels;
    }
    if (Array.isArray(deliverySource.details)) {
      summary.details = deliverySource.details
        .filter((detail) => detail && typeof detail === "object" && !Array.isArray(detail))
        .map((detail) => {
          const entry = /** @type {Record<string, unknown>} */ (detail);
          return {
            ...(typeof entry.channel === "string" ? { channel: entry.channel } : {}),
            ...(typeof entry.status === "string" ? { status: entry.status } : {}),
            ...(typeof entry.webhookStatus === "string"
              ? { webhookStatus: entry.webhookStatus }
              : {}),
          };
        });
    }
    if (Object.keys(summary).length > 0) diagnostics.delivery = summary;
  }
  return Object.keys(diagnostics).length > 0 ? diagnostics : null;
}

/** @param {{ workerVersionId: string }} input */
async function defaultHealthAnchor({ workerVersionId }) {
  const checks = await Promise.all(DEFAULT_CANARY_HEALTH_BASE_URLS.map((baseUrl) =>
    checkHealthEndpoint({
      baseUrl,
      expectedWorkerVersionId: workerVersionId,
      expectedSearchRolloutMode: "shadow",
    }),
  ));
  return { ok: checks.every((check) => check.ok), hosts: checks.map((check) => ({ url: check.url, ok: check.ok })) };
}

/** @param {{ workerVersionId: string, runId: string }} input */
async function defaultBackupLifecycle({ workerVersionId, runId }) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) throw new Error("backup_lifecycle_credentials_missing");
  const report = await runBackupLifecycleCanary({
    workerVersionId,
    gateRunId: runId,
    accountId,
    apiToken,
  });
  return { ok: report.ok, report };
}

/** @param {{ workerVersionId: string }} input */
async function defaultBackupLifecycleCleanup({ workerVersionId }) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) throw new Error("backup_lifecycle_credentials_missing");
  const report = await cleanupBackupLifecycleCanary({ workerVersionId, accountId, apiToken });
  return { ok: report.ok, report };
}

/** @param {{ workerVersionId: string, expectedSummary: unknown }} input */
async function defaultBackupLifecycleRecheck({ expectedSummary }) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) throw new Error("backup_lifecycle_credentials_missing");
  const report = await checkBackupLifecyclePolicy({ accountId, apiToken });
  const expected = readBackupLifecycleSummary(expectedSummary);
  return {
    ok: Boolean(
      expected &&
      report.lifecycleConfigSha256 === expected.lifecycleConfigSha256 &&
      report.policySha256 === expected.policySha256
    ),
    report,
  };
}

/** @param {{ workerVersionId: string, token: string }} input */
async function defaultPricing({ workerVersionId, token }) {
  const results = await Promise.all(PRICING_COUNTRIES.map((country) => fetchPreview({
    baseUrl: "https://0509.io",
    country,
    token,
    expectedWorkerVersionId: workerVersionId,
  })));
  return { ok: results.every((result) => result.ok), results };
}

/** @param {{ workerVersionId: string, runId: string, token: string }} input */
async function defaultBilling({ workerVersionId, runId, token }) {
  const config = {
    baseUrl: "https://0509.io",
    json: true,
    email: null,
    expectedWorkerVersionId: workerVersionId,
    gateRunId: runId,
  };
  const { payload, response } = await runBillingCanary({ config, token });
  const verdict = validateBillingCanaryResult(payload, response, {
    workerVersionId,
    gateRunId: runId,
  });
  return { ok: verdict.ok, blocker: verdict.ok ? null : verdict.blocker };
}

/** @param {{ workerVersionId: string, runId: string, token: string }} input */
async function defaultProof({ workerVersionId, runId, token }) {
  const { payload, response } = await runProofCanary({
    config: {
      baseUrl: "https://0509.io",
      json: true,
      cleanup: false,
      runId: null,
      digestRunId: null,
      proofCaptureId: null,
      proofProvider: null,
      requireSlack: false,
      requireWhatsApp: false,
      expectedWorkerVersionId: workerVersionId,
      gateRunId: runId,
    },
    token,
  });
  const identityOk = payload?.workerVersionId === workerVersionId && payload?.gateRunId === runId;
  return { ok: response.ok && payload?.ok === true && identityOk, payload };
}

/** @param {{ ticket: CleanupTicket | null, gateRunId: string, token: string }} input */
async function defaultCleanup({ ticket: _ticket, gateRunId: cleanupGateRunId, token }) {
  const { payload, response } = await runProofCanary({
    config: {
      baseUrl: "https://0509.io",
      json: true,
      cleanup: true,
      runId: null,
      digestRunId: null,
      proofCaptureId: null,
      proofProvider: null,
      requireSlack: false,
      requireWhatsApp: false,
      expectedWorkerVersionId: null,
      gateRunId: cleanupGateRunId,
    },
    token,
  });
  return { ok: response.ok && payload?.ok === true, payload };
}

/** @param {{ workerVersionId: string, token: string }} input */
async function defaultProductionCanary({ workerVersionId, token }) {
  const report = await runProductionCanary({
    expectedWorkerVersionId: workerVersionId,
    expectedSearchRolloutMode: "shadow",
    canaryBypassToken: token,
  });
  return { ok: report.passed, report };
}

/**
 * @param {{ workerVersionId: string, token: string, evidencePath: string, gateRunIdOverride?: string, now?: () => Date, dependencies?: GateDependencies }} input
 */
export async function runVersionBoundGateC({
  workerVersionId,
  token,
  evidencePath,
  gateRunIdOverride,
  now = () => new Date(),
  dependencies = {},
}) {
  if (!workerVersionId || !token || !evidencePath) throw new Error("gate_c_inputs_missing");
  const defaultRunId = gateRunId(workerVersionId);
  const runId = gateRunIdOverride ?? defaultRunId;
  if (
    typeof runId !== "string" ||
    !/^[a-z0-9._-]{1,128}$/u.test(runId) ||
    (gateRunIdOverride !== undefined && !runId.startsWith(`${defaultRunId}-`))
  ) throw new Error("gate_c_run_id_invalid");
  const healthAnchor = dependencies.healthAnchor ?? defaultHealthAnchor;
  const backupLifecycle = dependencies.backupLifecycle ?? defaultBackupLifecycle;
  const backupLifecycleRecheck = dependencies.backupLifecycleRecheck ?? defaultBackupLifecycleRecheck;
  const backupLifecycleCleanup = dependencies.backupLifecycleCleanup ?? defaultBackupLifecycleCleanup;
  const pricing = dependencies.pricing ?? defaultPricing;
  const billing = dependencies.billing ?? defaultBilling;
  const proof = dependencies.proof ?? defaultProof;
  const cleanup = dependencies.cleanup ?? defaultCleanup;
  const productionCanary = dependencies.productionCanary ?? defaultProductionCanary;
  /** @type {GateJournal} */
  const journal = {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    workerVersionId,
    searchRolloutMode: "shadow",
    gateRunId: runId,
    status: "running",
    steps: {},
    errors: [],
    ownerPid: process.pid,
  };
  const persist = () => atomicWrite(evidencePath, journal);
  try {
    claimInitialJournal(evidencePath, journal);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const existing = readExistingJournal(evidencePath, workerVersionId, runId);
    return reconcileExistingJournal({
      journal: existing,
      token,
      evidencePath,
      now,
      healthAnchor,
      backupLifecycleRecheck,
      backupLifecycleCleanup,
      cleanup,
    });
  }
  /** @type {CleanupTicket | null} */
  let cleanupTicket = null;

  /**
   * @template {GateStepResult} T
   * @param {string} name
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  const step = async (name, operation) => {
    journal.steps[name] = { status: "started", at: now().toISOString() };
    persist();
    const result = await operation();
    if (!result?.ok) throw new Error(safeStepError(name));
    journal.steps[name] = { status: "passed", at: now().toISOString() };
    persist();
    return result;
  };

  try {
    await step("identity_pre", () => healthAnchor({ workerVersionId }));
    const backup = await step("backup_lifecycle", () => backupLifecycle({ workerVersionId, runId }));
    journal.backupLifecycleSummary = backup.report;
    persist();
    await step("pricing", () => pricing({ workerVersionId, token }));
    await step("billing", () => billing({ workerVersionId, runId, token }));
    journal.steps.proof_email = { status: "started", at: now().toISOString() };
    persist();
    const proofResult = await proof({ workerVersionId, runId, token });
    const payload = proofResult.payload;
    const cleanupTicketMissing =
      typeof payload?.runId !== "string" || payload.runId.length === 0 ||
      typeof payload.digestRunId !== "string" || payload.digestRunId.length === 0 ||
      typeof payload.proofCaptureId !== "string" || payload.proofCaptureId.length === 0;
    if (proofResult.ok && cleanupTicketMissing) {
      throw new Error("proof_cleanup_ticket_missing");
    }
    if (!cleanupTicketMissing) {
      cleanupTicket = {
        runId: payload.runId,
        digestRunId: payload.digestRunId,
        proofCaptureId: payload.proofCaptureId,
      };
      journal.cleanupTicket = cleanupTicket;
      persist();
    }
    if (!proofResult.ok) {
      const diagnostics = sanitizeProofDiagnostics(payload);
      if (diagnostics) {
        journal.proofDiagnostics = diagnostics;
        persist();
      }
      throw new Error("proof_email_failed");
    }
    journal.steps.proof_email = { status: "passed", at: now().toISOString() };
    persist();
    const live = await step("production_meta", () => productionCanary({ workerVersionId, token }));
    journal.productionSummary = formatProductionSummary(live.report);
  } catch (error) {
    journal.errors.push(error instanceof Error ? error.message : "gate_c_primary_failed");
  } finally {
    if (journal.steps.proof_email) {
      try {
        await step("proof_cleanup", () => cleanup({ ticket: cleanupTicket, gateRunId: runId, token }));
      } catch {
        journal.errors.push("proof_cleanup_failed");
      }
    }
    try {
      await step("identity_post", () => healthAnchor({ workerVersionId }));
    } catch {
      journal.errors.push("identity_post_failed");
    }
  }

  journal.completedAt = now().toISOString();
  journal.status = journal.errors.length === 0 ? "passed" : "failed";
  persist();
  return { passed: journal.status === "passed", journal };
}

/** @param {unknown} error */
function isAlreadyExistsError(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/** @param {unknown} value */
function isCleanupTicket(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ticket = /** @type {Record<string, unknown>} */ (value);
  return [ticket.runId, ticket.digestRunId, ticket.proofCaptureId].every(
    (part) => typeof part === "string" && part.length > 0 && part.length <= 256 && part.trim() === part && !/[\u0000-\u001f\u007f\s]/u.test(part),
  );
}

/** @param {unknown} value */
function readBackupLifecycleSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = /** @type {Record<string, unknown>} */ (value);
  if (
    summary.ok !== true ||
    summary.remoteObjectAbsent !== true ||
    typeof summary.lifecycleConfigSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(summary.lifecycleConfigSha256) ||
    typeof summary.policySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(summary.policySha256)
  ) return null;
  return {
    lifecycleConfigSha256: summary.lifecycleConfigSha256,
    policySha256: summary.policySha256,
  };
}

/** @param {GateJournal} journal */
function isCompletePassedJournal(journal) {
  return (
    journal.schemaVersion === 1 &&
    journal.searchRolloutMode === "shadow" &&
    journal.status === "passed" &&
    journal.errors.length === 0 &&
    isCleanupTicket(journal.cleanupTicket) &&
    readBackupLifecycleSummary(journal.backupLifecycleSummary) !== null &&
    typeof journal.productionSummary === "string" &&
    REQUIRED_PASSED_STEPS.every((name) => journal.steps[name]?.status === "passed")
  );
}

/** @param {GateJournal} journal */
function hasActiveOwner(journal) {
  const ownerPid = journal.ownerPid;
  if (journal.status !== "running" || !Number.isSafeInteger(ownerPid) || typeof ownerPid !== "number" || ownerPid <= 0) return false;
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   journal: GateJournal,
 *   token: string,
 *   evidencePath: string,
 *   now: () => Date,
 *   healthAnchor: NonNullable<GateDependencies["healthAnchor"]>,
 *   backupLifecycleRecheck: NonNullable<GateDependencies["backupLifecycleRecheck"]>,
 *   backupLifecycleCleanup: NonNullable<GateDependencies["backupLifecycleCleanup"]>,
 *   cleanup: NonNullable<GateDependencies["cleanup"]>
 * }} input
 */
async function reconcileExistingJournal({ journal, token, evidencePath, now, healthAnchor, backupLifecycleRecheck, backupLifecycleCleanup, cleanup }) {
  const persist = () => atomicWrite(evidencePath, journal);
  if (journal.status === "passed") {
    if (!isCompletePassedJournal(journal)) throw new Error("gate_c_existing_passed_journal_incomplete");
    const currentTime = now();
    const generatedAt = typeof journal.generatedAt === "string" ? Date.parse(journal.generatedAt) : Number.NaN;
    if (
      !Number.isFinite(generatedAt) ||
      generatedAt > currentTime.getTime() + 5 * 60 * 1000 ||
      currentTime.getTime() - generatedAt > GATE_C_EVIDENCE_MAX_AGE_MS
    ) throw new Error("gate_c_existing_passed_journal_stale");
    journal.steps.backup_lifecycle_recheck = { status: "started", at: currentTime.toISOString() };
    persist();
    try {
      const lifecycle = await backupLifecycleRecheck({
        workerVersionId: journal.workerVersionId,
        expectedSummary: journal.backupLifecycleSummary,
      });
      if (!lifecycle?.ok) throw new Error("backup_lifecycle_recheck_failed");
      journal.steps.backup_lifecycle_recheck = { status: "passed", at: now().toISOString() };
      journal.steps.identity_recheck = { status: "started", at: now().toISOString() };
      persist();
      const identity = await healthAnchor({ workerVersionId: journal.workerVersionId });
      if (!identity?.ok) throw new Error("identity_recheck_failed");
      journal.steps.identity_recheck = { status: "passed", at: now().toISOString() };
      journal.completedAt = now().toISOString();
      persist();
      return { passed: true, journal };
    } catch (error) {
      journal.errors.push(error instanceof Error ? error.message : "gate_c_recheck_failed");
      journal.status = "failed";
      journal.completedAt = now().toISOString();
      persist();
      return { passed: false, journal };
    }
  }

  if (hasActiveOwner(journal)) throw new Error("gate_c_existing_journal_active");
  const backupStarted = Boolean(journal.steps.backup_lifecycle);
  const backupPassed = journal.steps.backup_lifecycle?.status === "passed";
  if (backupStarted && !backupPassed) {
    journal.steps.backup_lifecycle_cleanup = { status: "started", at: now().toISOString() };
    persist();
    try {
      const result = await backupLifecycleCleanup({ workerVersionId: journal.workerVersionId });
      if (!result?.ok) throw new Error("backup_lifecycle_cleanup_failed");
      journal.steps.backup_lifecycle_cleanup = { status: "passed", at: now().toISOString() };
      persist();
    } catch {
      if (!journal.errors.includes("backup_lifecycle_cleanup_failed")) journal.errors.push("backup_lifecycle_cleanup_failed");
    }
  }
  const proofStarted = Boolean(journal.steps.proof_email);
  const cleanupPassed = journal.steps.proof_cleanup?.status === "passed";
  if (proofStarted && !cleanupPassed) {
    journal.steps.proof_cleanup = { status: "started", at: now().toISOString() };
    persist();
    try {
      const result = await cleanup({
        ticket: isCleanupTicket(journal.cleanupTicket)
          ? /** @type {CleanupTicket} */ (journal.cleanupTicket)
          : null,
        gateRunId: journal.gateRunId,
        token,
      });
      if (!result?.ok) throw new Error("proof_cleanup_failed");
      journal.steps.proof_cleanup = { status: "passed", at: now().toISOString() };
      persist();
    } catch {
      if (!journal.errors.includes("proof_cleanup_failed")) journal.errors.push("proof_cleanup_failed");
    }
  }

  if (journal.steps.identity_post?.status !== "passed") {
    journal.steps.identity_post = { status: "started", at: now().toISOString() };
    persist();
    try {
      const identity = await healthAnchor({ workerVersionId: journal.workerVersionId });
      if (!identity?.ok) throw new Error("identity_post_failed");
      journal.steps.identity_post = { status: "passed", at: now().toISOString() };
      persist();
    } catch {
      if (!journal.errors.includes("identity_post_failed")) journal.errors.push("identity_post_failed");
    }
  }
  if (!journal.errors.includes("gate_c_existing_journal_recovered_not_passed")) {
    journal.errors.push("gate_c_existing_journal_recovered_not_passed");
  }
  journal.status = "failed";
  journal.completedAt = now().toISOString();
  persist();
  return { passed: false, journal };
}

/** @param {unknown} report */
function formatProductionSummary(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return "passed";
  if (!("healthChecks" in report) && !("health" in report)) return "passed";
  return formatProductionCanaryReport(
    /** @type {Awaited<ReturnType<typeof runProductionCanary>>} */ (report),
  );
}

/** @param {string} path @param {string} workerVersionId @param {string} runId */
function readExistingJournal(path, workerVersionId, runId) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600) {
    throw new Error("gate_c_existing_journal_unsafe");
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("gate_c_existing_journal_unsafe");
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("gate_c_existing_journal_invalid");
  }
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    parsed.workerVersionId !== workerVersionId || parsed.gateRunId !== runId ||
    parsed.schemaVersion !== 1 || parsed.searchRolloutMode !== "shadow" ||
    (parsed.status !== "passed" && parsed.status !== "failed" && parsed.status !== "running") ||
    !parsed.steps || typeof parsed.steps !== "object" || Array.isArray(parsed.steps) ||
    !Array.isArray(parsed.errors)
  ) {
    throw new Error("gate_c_existing_journal_conflict");
  }
  return /** @type {GateJournal} */ (parsed);
}

async function main() {
  const wranglerOutputPath = readArg("--wrangler-output");
  if (!wranglerOutputPath) throw new Error("wrangler_output_path_missing");
  const workerVersionId = readDeployedWorkerVersionId(
    readFileSync(resolve(wranglerOutputPath), "utf8"),
  );
  const token = process.env.CANARY_BYPASS_TOKEN?.trim();
  if (!token) throw new Error("canary_bypass_token_missing");
  const safeVersion = gateRunId(workerVersionId);
  const requestedEvidencePath = readArg("--evidence");
  const evidencePath = requestedEvidencePath
    ? resolve(requestedEvidencePath)
    : resolve("test-results", `${safeVersion}.json`);
  if (
    requestedEvidencePath &&
    (!/^test-results\/gate-c-[A-Za-z0-9._-]{1,160}\.json$/u.test(requestedEvidencePath) || requestedEvidencePath.includes(".."))
  ) throw new Error("gate_c_evidence_path_invalid");
  const gateRunIdOverride = readArg("--gate-run-id") ?? undefined;
  const result = await runVersionBoundGateC({ workerVersionId, token, evidencePath, gateRunIdOverride });
  process.stdout.write(`${JSON.stringify({
    passed: result.passed,
    workerVersionId,
    evidencePath,
    errors: result.journal.errors,
    ...(result.journal.proofDiagnostics
      ? { proofDiagnostics: result.journal.proofDiagnostics }
      : {}),
  })}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "post_deploy_release_verification_failed"}\n`);
    process.exitCode = 1;
  });
}
