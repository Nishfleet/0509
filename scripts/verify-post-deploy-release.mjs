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

import {
  BACKUP_PROOF_DEFERRED,
  BACKUP_PROOF_REQUIRED,
  createDeferredBackupDisposition,
  normalizeBackupProofStatus,
  readDeployedWorkerVersionId,
  validateDeferredBackupDisposition,
} from "./deploy-production-plan.mjs";
import {
  DEFAULT_CANARY_HEALTH_BASE_URLS,
  formatProductionCanaryReport,
  runProductionCanary,
  waitForExpectedWorkerVersion,
} from "./prod-canary.lib.mjs";
import { fetchPreview } from "./dodo-pricing-canary.mjs";
import {
  runCanary as runBillingCanary,
  validateBillingCanaryResult,
} from "./dodo-billing-canary.mjs";
import { runCanary as runProofCanary } from "./launch-readiness-canary.mjs";

/**
 * The live commit the deferred schema gate compared against, as recorded by
 * scripts/check-deferred-release-zero-migrations.mjs earlier in this deploy.
 *
 * Refuses rather than guessing: a deferred release whose baseline cannot be
 * read has no trustworthy evidence to journal, and the disposition validator
 * would reject a malformed one anyway.
 */
function readDeferredBaselineSha() {
  const path = resolve(
    process.cwd(),
    "test-results/deferred-release-baseline.json",
  );
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("deferred_release_baseline_unreadable");
  }
  const sha = parsed?.baselineSha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/u.test(sha)) {
    throw new Error("deferred_release_baseline_invalid");
  }
  return sha;
}
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
const DEFERRED_BACKUP_REQUIRED_PASSED_STEPS = Object.freeze(
  REQUIRED_PASSED_STEPS.filter((step) => step !== "backup_lifecycle"),
);
const SHA = /^[a-f0-9]{40}$/u;
const GATE_PHASE_IMMEDIATE = "immediate";
const SAFE_PRIVATE_VALUE = /^[^\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u;
const RELEASE_COMPATIBLE_EMAIL_BLOCKERS = Object.freeze([
  "no_recent_email_delivery_attempt",
  "no_recent_email_sent",
]);

/** @typedef {{ runId: string, digestRunId: string, proofCaptureId: string }} CleanupTicket */
/** @typedef {{ runId?: unknown, digestRunId?: unknown, proofCaptureId?: unknown, proofEmail?: unknown, [key: string]: unknown }} ProofPayload */
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
 *   gatePhase?: "immediate",
 *   status: string,
 *   steps: Record<string, { status: "started" | "passed" | "failed" | "reused", at: string, detail?: unknown }>,
 *   errors: string[],
 *   cleanupTicket?: CleanupTicket,
 *   productionSummary?: string,
 *   backupLifecycleSummary?: unknown,
 *   backupProofStatus?: "required" | "deferred",
 *   backupProofDisposition?: Record<string, unknown>,
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

/** @param {unknown} value @param {string[]} keys */
function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

/** @param {unknown} value */
function validIso(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/** @param {unknown} value @param {number} maxLength */
function validPrivateValue(value, maxLength) {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length <= maxLength &&
      SAFE_PRIVATE_VALUE.test(value))
  );
}

/** @param {any} value @param {string} gateRunId */
function validateProofEmailRouteEvidence(value, gateRunId) {
  if (
    !exactKeys(value, ["gateRunId", "dispatchStartedAt", "subject", "provider"]) ||
    value.gateRunId !== gateRunId ||
    !validIso(value.dispatchStartedAt) ||
    value.subject !== `0509 Gate C proof ${gateRunId}` ||
    value.subject.split(gateRunId).length !== 2 ||
    !exactKeys(value.provider, ["status", "accepted", "messageId", "error"]) ||
    !["sent", "pending", "failed"].includes(value.provider.status) ||
    value.provider.accepted !== (value.provider.status === "sent") ||
    !validPrivateValue(value.provider.messageId, 512) ||
    !validPrivateValue(value.provider.error, 1_024) ||
    (value.provider.status === "sent" &&
      (typeof value.provider.messageId !== "string" ||
        value.provider.messageId.length === 0 ||
        value.provider.error !== null))
  ) {
    return false;
  }
  return true;
}

/** @param {ProofPayload | undefined} payload @param {string} gateRunId */
function readProofEmailStepDetail(payload, gateRunId) {
  const value = /** @type {any} */ (payload?.proofEmail);
  if (!validateProofEmailRouteEvidence(value, gateRunId)) {
    throw new Error("proof_email_dispatch_invalid");
  }
  return {
    detail: {
      gateRunId,
      dispatchStartedAt: value.dispatchStartedAt,
      subject: value.subject,
    },
    providerStatus: value.provider.status,
  };
}

/** @param {unknown} value */
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** @param {unknown} value */
function hasExactlyReleaseCompatibleEmailBlockers(value) {
  if (!Array.isArray(value) || value.length !== RELEASE_COMPATIBLE_EMAIL_BLOCKERS.length) {
    return false;
  }
  const blockers = new Set(value);
  return (
    blockers.size === RELEASE_COMPATIBLE_EMAIL_BLOCKERS.length &&
    RELEASE_COMPATIBLE_EMAIL_BLOCKERS.every((blocker) => blockers.has(blocker))
  );
}

/**
 * The public launch-readiness route intentionally remains strict about real
 * customer digest delivery. Gate C's proof email is deliberately internal, so
 * a release may accept only the exact customer-digest-absent response after the
 * same-run proof email has already been provider-accepted. Every other
 * production canary assertion remains fail-closed.
 *
 * @param {GateStepResult} result
 * @param {{ journal: GateJournal, proofEmail: { detail: { gateRunId: string, dispatchStartedAt: string, subject: string }, providerStatus: string }, runId: string, workerVersionId: string }} context
 */
function acceptSameRunInternalProofForProductionMeta(result, context) {
  if (result?.ok) return result;
  if (
    context.journal.steps.proof_email?.status !== "passed" ||
    !validProofEmailStepDetail(context.journal.steps.proof_email.detail, context.runId) ||
    context.proofEmail.providerStatus !== "sent" ||
    !validProofEmailStepDetail(context.proofEmail.detail, context.runId)
  ) {
    return result;
  }

  const report = isRecord(result?.report) ? /** @type {any} */ (result.report) : null;
  const readiness = isRecord(report?.launchReadiness) ? report.launchReadiness : null;
  const signals = isRecord(readiness?.signals) ? readiness.signals : null;
  const digestDelivery = isRecord(signals?.digestDelivery) ? signals.digestDelivery : null;
  const emailDelivery = isRecord(signals?.emailDelivery) ? signals.emailDelivery : null;
  const latestAttemptAt = emailDelivery?.latestAttemptAt;
  const proofDispatchStartedAt = context.proofEmail.detail.dispatchStartedAt;
  const healthChecks = Array.isArray(report?.healthChecks) ? report.healthChecks : [];
  const expectedHealthUrls = DEFAULT_CANARY_HEALTH_BASE_URLS.map(
    (baseUrl) => new URL("/api/health", baseUrl).toString(),
  );
  const actualHealthUrls = healthChecks.map((/** @type {any} */ check) => check?.url);
  const healthIsExact =
    healthChecks.length === expectedHealthUrls.length &&
    JSON.stringify(actualHealthUrls) === JSON.stringify(expectedHealthUrls) &&
    healthChecks.every((/** @type {any} */ check) =>
      check?.ok === true &&
      check?.status === 200 &&
      check?.app === "0509" &&
      check?.expectedWorkerVersionId === context.workerVersionId &&
      check?.expectedSearchRolloutMode === "v2" &&
      check?.releaseIdentityOk === true &&
      check?.releaseIdentity?.workerVersionId === context.workerVersionId &&
      check?.releaseIdentity?.searchRolloutMode === "v2"
    );
  const genericEmailIsCurrent =
    Number.isFinite(emailDelivery?.recentAttempts) &&
    emailDelivery.recentAttempts > 0 &&
    Number.isFinite(emailDelivery?.recentSent) &&
    emailDelivery.recentSent > 0 &&
    validIso(latestAttemptAt) &&
    Date.parse(latestAttemptAt) >= Date.parse(proofDispatchStartedAt);
  const allOtherAssertionsPassed =
    report?.passed === false &&
    report?.expectedWorkerVersionId === context.workerVersionId &&
    report?.expectedSearchRolloutMode === "v2" &&
    healthIsExact &&
    report?.freshLiveBypass?.required === true &&
    report?.freshLiveBypass?.configured === true &&
    report?.freshLiveBypass?.proved === true &&
    Array.isArray(report?.blockingFailures) &&
    report.blockingFailures.length === 0 &&
    report?.metaAdsBeta?.status === "ok" &&
    Array.isArray(report?.metaAdsBeta?.failures) &&
    report.metaAdsBeta.failures.length === 0 &&
    readiness?.metaAdsBeta?.ok === true;

  if (
    readiness?.ok !== false ||
    readiness?.status !== 503 ||
    !hasExactlyReleaseCompatibleEmailBlockers(readiness?.blockers) ||
    digestDelivery?.recentAttempts !== 0 ||
    digestDelivery?.recentSent !== 0 ||
    !genericEmailIsCurrent ||
    !allOtherAssertionsPassed
  ) {
    return result;
  }

  return {
    ...result,
    ok: true,
    report: {
      ...report,
      releaseCompatibility: {
        status: "same_run_internal_proof_accepted",
        gateRunId: context.runId,
        customerDigestReadiness: "blocked",
      },
    },
  };
}

/** @param {any} value @param {string} gateRunId */
function validProofEmailStepDetail(value, gateRunId) {
  return (
    exactKeys(value, ["gateRunId", "dispatchStartedAt", "subject"]) &&
    value.gateRunId === gateRunId &&
    validIso(value.dispatchStartedAt) &&
    value.subject === `0509 Gate C proof ${gateRunId}` &&
    value.subject.split(gateRunId).length === 2
  );
}

/** @param {GateJournal} journal */
function hasValidProofEmailContract(journal) {
  return (
    isCleanupTicket(journal.cleanupTicket) &&
    journal.steps.proof_email?.status === "passed" &&
    validProofEmailStepDetail(
      journal.steps.proof_email.detail,
      journal.gateRunId,
    )
  );
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

/**
 * Anchor the release identity by REQUIRING the exact deployed Worker version +
 * v2 rollout mode to hold on ALL THREE public aliases for several consecutive
 * samples, not just a single fresh-connection snapshot. Deploy attempt 18's
 * Gate C (run 29764511397) flapped because this ran as a one-shot Promise.all
 * from a fresh process: its new connections hit a lagging/flapping edge colo
 * that the propagation waiter's already-converged connections had moved past,
 * and identity_pre/identity_post failed 0.6s after the waiter declared all
 * three aliases stable. Sharing waitForExpectedWorkerVersion makes the anchor
 * bounded and consecutive-sampling — assertion strength is unchanged (exact
 * worker + v2 rollout on all three aliases) but now proven over `requiredConsecutive`
 * samples instead of one. On the waiter's fail-closed throw we return
 * `{ ok: false }` so the surrounding step machinery emits the SAME
 * identity_pre_failed / identity_post_failed identifiers as before — nothing
 * downstream changes.
 * @param {{ workerVersionId: string, checkHealthImpl?: Parameters<typeof waitForExpectedWorkerVersion>[0]["checkHealthImpl"], delayImpl?: (ms: number) => Promise<void>, healthBaseUrls?: string[], maxSamples?: number, maxWaitMs?: number, requiredConsecutive?: number }} input
 */
export async function defaultHealthAnchor({
  workerVersionId,
  checkHealthImpl,
  delayImpl,
  healthBaseUrls,
  maxSamples,
  maxWaitMs,
  requiredConsecutive,
}) {
  try {
    await waitForExpectedWorkerVersion({
      expectedWorkerVersionId: workerVersionId,
      ...(healthBaseUrls ? { healthBaseUrls } : {}),
      ...(checkHealthImpl ? { checkHealthImpl } : {}),
      ...(delayImpl ? { delayImpl } : {}),
      ...(maxSamples !== undefined ? { maxSamples } : {}),
      ...(maxWaitMs !== undefined ? { maxWaitMs } : {}),
      ...(requiredConsecutive !== undefined ? { requiredConsecutive } : {}),
    });
    const hosts = (healthBaseUrls?.length ? healthBaseUrls : DEFAULT_CANARY_HEALTH_BASE_URLS).map(
      (url) => ({ url, ok: true }),
    );
    return { ok: true, hosts };
  } catch {
    return { ok: false, error: "worker_identity_not_stable" };
  }
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

/**
 * @param {{ workerVersionId: string, token: string, attempts?: number, delayMs?: number, sleeper?: (ms: number) => Promise<void>, fetcher?: (input: { baseUrl: string, country: string, token: string, expectedWorkerVersionId?: string | null }) => Promise<{ ok: boolean, requestedCountry?: string, reason?: string } & Record<string, unknown>> }} input
 *
 * Each country is checked with a small bounded retry. This does NOT weaken the
 * gate — every country must still return fully valid, version-pinned pricing —
 * it only tolerates one-shot transients that a single request can hit right
 * after a worker flip: an edge PoP still serving the previous version (the
 * validator pins preview.workerVersionId, so a straggler isolate fails the
 * check honestly) or a slow cold Dodo live-pricing call. Run 29852903771 was
 * rolled back by exactly such a one-shot failure. A persistent pricing defect
 * still fails all attempts and blocks the release.
 */
export async function defaultPricing({ workerVersionId, token, attempts = 3, delayMs = 4_000, sleeper, fetcher }) {
  const wait = sleeper ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchOne = fetcher ?? fetchPreview;
  const results = await Promise.all(PRICING_COUNTRIES.map(async (country) => {
    let last = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        last = await fetchOne({
          baseUrl: "https://0509.io",
          country,
          token,
          expectedWorkerVersionId: workerVersionId,
        });
      } catch (error) {
        last = {
          requestedCountry: country,
          ok: false,
          status: 0,
          reason: `fetch_failed:${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`,
        };
      }
      if (last.ok) return { ...last, attempt };
      if (attempt < attempts) await wait(delayMs);
    }
    return { ...(last ?? { requestedCountry: country, ok: false, status: 0, reason: "no_attempt" }), attempt: attempts };
  }));
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
    expectedSearchRolloutMode: "v2",
    canaryBypassToken: token,
  });
  return { ok: report.passed, report };
}

/**
 * @param {{ workerVersionId: string, token: string, evidencePath: string, gateRunIdOverride?: string, releaseSha?: string, backupProofStatus?: string, backupProofDisposition?: Record<string, unknown>, now?: () => Date, dependencies?: GateDependencies }} input
 */
export async function runVersionBoundGateC({
  workerVersionId,
  token,
  evidencePath,
  gateRunIdOverride,
  releaseSha,
  backupProofStatus = BACKUP_PROOF_REQUIRED,
  backupProofDisposition,
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
  const normalizedBackupProofStatus =
    normalizeBackupProofStatus(backupProofStatus);
  const normalizedReleaseSha =
    typeof releaseSha === "string" ? releaseSha : "";
  if (normalizedBackupProofStatus === BACKUP_PROOF_DEFERRED) {
    if (
      !SHA.test(normalizedReleaseSha) ||
      !validateDeferredBackupDisposition(
        backupProofDisposition,
        normalizedReleaseSha,
      )
    ) {
      throw new Error("gate_c_deferred_backup_proof_invalid");
    }
  } else if (backupProofDisposition !== undefined) {
    throw new Error("gate_c_required_backup_proof_conflict");
  }
  const healthAnchor = /** @type {(input: { workerVersionId: string }) => Promise<GateStepResult>} */ (dependencies.healthAnchor ?? defaultHealthAnchor);
  const backupLifecycle = dependencies.backupLifecycle ?? defaultBackupLifecycle;
  const backupLifecycleRecheck = dependencies.backupLifecycleRecheck ?? defaultBackupLifecycleRecheck;
  const backupLifecycleCleanup = dependencies.backupLifecycleCleanup ?? defaultBackupLifecycleCleanup;
  const pricing = /** @type {(input: { workerVersionId: string, token: string }) => Promise<GateStepResult>} */ (dependencies.pricing ?? defaultPricing);
  const billing = dependencies.billing ?? defaultBilling;
  const proof = dependencies.proof ?? defaultProof;
  const cleanup = dependencies.cleanup ?? defaultCleanup;
  const productionCanary = dependencies.productionCanary ?? defaultProductionCanary;
  /** @type {GateJournal} */
  const journal = {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    workerVersionId,
    searchRolloutMode: "v2",
    gateRunId: runId,
    gatePhase: GATE_PHASE_IMMEDIATE,
    backupProofStatus: normalizedBackupProofStatus,
    ...(normalizedBackupProofStatus === BACKUP_PROOF_DEFERRED
      ? { backupProofDisposition }
      : {}),
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
    const existing = readExistingJournal(
      evidencePath,
      workerVersionId,
      runId,
      normalizedBackupProofStatus,
      releaseSha,
    );
    const reconciled = await reconcileExistingJournal({
      journal: existing,
      token,
      evidencePath,
      now,
      healthAnchor,
      backupLifecycleRecheck,
      backupLifecycleCleanup,
      cleanup,
    });
    return reconciled;
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
    if (!result?.ok) {
      // Record WHY before failing: run 29852903771's pricing rollback left only
      // {status:"started"} in the evidence and the diagnosis needed manual
      // artifact archaeology. Detail is bounded and secret-free (step results
      // are already sanitized summaries).
      journal.steps[name] = {
        status: "failed",
        at: now().toISOString(),
        detail: JSON.parse(JSON.stringify(result ?? null))
      };
      persist();
      throw new Error(safeStepError(name));
    }
    journal.steps[name] = { status: "passed", at: now().toISOString() };
    persist();
    return result;
  };

  try {
    await step("identity_pre", () => healthAnchor({ workerVersionId }));
    if (normalizedBackupProofStatus === BACKUP_PROOF_REQUIRED) {
      const backup = await step("backup_lifecycle", () =>
        backupLifecycle({ workerVersionId, runId }),
      );
      journal.backupLifecycleSummary = backup.report;
      persist();
    }
    await step("pricing", () => pricing({ workerVersionId, token }));
    await step("billing", () => billing({ workerVersionId, runId, token }));
    journal.steps.proof_email = { status: "started", at: now().toISOString() };
    persist();
    let proofResult;
    try {
      proofResult = await proof({ workerVersionId, runId, token });
    } catch {
      persist();
      throw new Error("proof_email_failed");
    }
    const payload = proofResult.payload;
    const cleanupTicketMissing =
      typeof payload?.runId !== "string" || payload.runId.length === 0 ||
      typeof payload.digestRunId !== "string" || payload.digestRunId.length === 0 ||
      typeof payload.proofCaptureId !== "string" || payload.proofCaptureId.length === 0;
    if (!cleanupTicketMissing) {
      cleanupTicket = {
        runId: payload.runId,
        digestRunId: payload.digestRunId,
        proofCaptureId: payload.proofCaptureId,
      };
      journal.cleanupTicket = cleanupTicket;
    }
    const proofEmail = readProofEmailStepDetail(payload, runId);
    journal.steps.proof_email = {
      status:
        proofResult.ok && proofEmail.providerStatus === "sent"
          ? "passed"
          : "failed",
      at: now().toISOString(),
      detail: proofEmail.detail,
    };
    persist();
    if (proofResult.ok && cleanupTicketMissing) {
      throw new Error("proof_cleanup_ticket_missing");
    }
    if (!proofResult.ok || proofEmail.providerStatus !== "sent") {
      const diagnostics = sanitizeProofDiagnostics(payload);
      if (diagnostics) {
        journal.proofDiagnostics = diagnostics;
        persist();
      }
      throw new Error("proof_email_failed");
    }
    const live = await step("production_meta", async () =>
      acceptSameRunInternalProofForProductionMeta(
        await productionCanary({ workerVersionId, token }),
        { journal, proofEmail, runId, workerVersionId },
      )
    );
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
function hasValidBackupProofContract(journal) {
  let status;
  try {
    status = normalizeBackupProofStatus(journal.backupProofStatus);
  } catch {
    return false;
  }
  if (status === BACKUP_PROOF_REQUIRED) {
    return (
      journal.steps.backup_lifecycle?.status === "passed" &&
      readBackupLifecycleSummary(journal.backupLifecycleSummary) !== null &&
      journal.backupProofDisposition === undefined
    );
  }
  return (
    validateDeferredBackupDisposition(
      journal.backupProofDisposition,
      typeof journal.backupProofDisposition?.candidateSha === "string"
        ? journal.backupProofDisposition.candidateSha
        : "",
    ) &&
    journal.backupLifecycleSummary === undefined &&
    !Object.keys(journal.steps).some((name) =>
      name.startsWith("backup_lifecycle"),
    )
  );
}

/** @param {GateJournal} journal */
function isCompletePassedJournal(journal) {
  let backupProofStatus;
  try {
    backupProofStatus = normalizeBackupProofStatus(journal.backupProofStatus);
  } catch {
    return false;
  }
  const requiredSteps =
    backupProofStatus === BACKUP_PROOF_DEFERRED
      ? DEFERRED_BACKUP_REQUIRED_PASSED_STEPS
      : REQUIRED_PASSED_STEPS;
  return (
    journal.schemaVersion === 1 &&
    journal.gatePhase === GATE_PHASE_IMMEDIATE &&
    journal.searchRolloutMode === "v2" &&
    journal.status === "passed" &&
    journal.errors.length === 0 &&
    isCleanupTicket(journal.cleanupTicket) &&
    hasValidBackupProofContract(journal) &&
    hasValidProofEmailContract(journal) &&
    typeof journal.productionSummary === "string" &&
    requiredSteps.every((name) => journal.steps[name]?.status === "passed")
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
    try {
      if (
        normalizeBackupProofStatus(journal.backupProofStatus) ===
        BACKUP_PROOF_REQUIRED
      ) {
        journal.steps.backup_lifecycle_recheck = {
          status: "started",
          at: currentTime.toISOString(),
        };
        persist();
        const lifecycle = await backupLifecycleRecheck({
          workerVersionId: journal.workerVersionId,
          expectedSummary: journal.backupLifecycleSummary,
        });
        if (!lifecycle?.ok) throw new Error("backup_lifecycle_recheck_failed");
        journal.steps.backup_lifecycle_recheck = {
          status: "passed",
          at: now().toISOString(),
        };
      }
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
  const summary = formatProductionCanaryReport(
    /** @type {Awaited<ReturnType<typeof runProductionCanary>>} */ (report),
  );
  const compatibility = /** @type {any} */ (report).releaseCompatibility;
  return compatibility?.status === "same_run_internal_proof_accepted"
    ? `${summary}\nrelease compatibility: same-run internal proof accepted; customer digest readiness remains blocked`
    : summary;
}

/** @param {string} path @param {string} workerVersionId @param {string} runId @param {string} backupProofStatus @param {string | undefined} releaseSha */
function readExistingJournal(
  path,
  workerVersionId,
  runId,
  backupProofStatus,
  releaseSha,
) {
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
  let existingBackupProofStatus;
  try {
    existingBackupProofStatus = normalizeBackupProofStatus(
      parsed?.backupProofStatus,
    );
  } catch {
    throw new Error("gate_c_existing_journal_conflict");
  }
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    parsed.workerVersionId !== workerVersionId || parsed.gateRunId !== runId ||
    parsed.schemaVersion !== 1 || parsed.searchRolloutMode !== "v2" ||
    (parsed.status !== "passed" && parsed.status !== "failed" && parsed.status !== "running") ||
    !parsed.steps || typeof parsed.steps !== "object" || Array.isArray(parsed.steps) ||
    !Array.isArray(parsed.errors) ||
    existingBackupProofStatus !== backupProofStatus ||
    parsed.gatePhase !== GATE_PHASE_IMMEDIATE ||
    (backupProofStatus === BACKUP_PROOF_DEFERRED &&
      !validateDeferredBackupDisposition(
        parsed.backupProofDisposition,
        releaseSha ?? "",
      )) ||
    (backupProofStatus === BACKUP_PROOF_REQUIRED &&
      parsed.backupProofDisposition !== undefined)
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
  const backupProofStatus = normalizeBackupProofStatus(
    process.env.BACKUP_PROOF_STATUS,
  );
  const releaseSha = process.env.PINNED_SHA?.trim();
  let deferredBackupProof = {};
  if (backupProofStatus === BACKUP_PROOF_DEFERRED) {
    // The baseline is read from the evidence the schema gate wrote earlier in
    // this same deploy, so the journal records the commit that was actually
    // compared against. It used to be a constant in the disposition, which let
    // the recorded evidence and the executed check drift apart silently.
    deferredBackupProof = {
      backupProofDisposition: createDeferredBackupDisposition(
        releaseSha ?? "",
        readDeferredBaselineSha(),
      ),
    };
  }
  const result = await runVersionBoundGateC({
    workerVersionId,
    token,
    evidencePath,
    gateRunIdOverride,
    backupProofStatus,
    releaseSha,
    ...deferredBackupProof,
  });
  process.stdout.write(`${JSON.stringify({
    passed: result.passed,
    workerVersionId,
    evidencePath,
    backupProofStatus,
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
