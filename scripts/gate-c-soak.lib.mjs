import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import {
  expectedReleaseSchedule,
  releaseObservationKey,
} from "./release-scheduled-observation-contract.mjs";

export const GATE_C_SOAK_SCHEMA_VERSION = 1;
export const GATE_C_SOAK_DURATION_MS = 24 * 60 * 60 * 1000;
export const GATE_C_SOAK_FINALIZE_GRACE_MS = 12 * 60 * 60 * 1000;
export const GATE_C_SOAK_SETTLE_MS = 20 * 60 * 1000;
export const GATE_C_UPTIME_MIN_SAMPLES = 276;
export const GATE_C_UPTIME_MAX_GAP_MS = 15 * 60 * 1000;
const GATE_C_MAX_TASK_DURATION_MS = 15 * 60 * 1000;
const GATE_C_MAX_SCHEDULED_RUN_COMPLETION_MS = 2 * 60 * 60 * 1000;
const GATE_C_MAX_DIGEST_JOB_COMPLETION_MS = 2 * 60 * 60 * 1000;

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_VERSION = /^[A-Za-z0-9._-]{1,128}$/u;
const SAFE_TEST_RESULTS_PATH = /^test-results\/[A-Za-z0-9._/-]{1,220}$/u;
const SAFE_RELEASE_TASK_NAMES = new Set([
  "billing_lifecycle_email_recovery",
  "weekly_business_numbers",
  "digest_schedule_exhaustion_recovery",
  "digest_schedule_recovery",
  "discovery_warmup",
  "monitoring_fanout_reconciliation",
  "instant_alert_flush",
  "retention_sweep",
  "presence_polling_batch",
  "scheduled_monitoring",
  "customer_at_risk_alert",
]);
const REQUIRED_GATE_C_STEPS = Object.freeze([
  "identity_pre",
  "backup_lifecycle",
  "pricing",
  "billing",
  "proof_email",
  "production_meta",
  "proof_cleanup",
  "identity_post",
]);

/** @typedef {Record<string, any>} JsonRecord */
/**
 * @typedef {object} WorkflowRunQuery
 * @property {string} repository
 * @property {string} workflow
 * @property {string | null} event
 * @property {string | null} startedAt
 * @property {string | null} endedAt
 * @property {string} token
 * @property {typeof fetch | undefined} [fetchImpl]
 */
/**
 * @typedef {object} WorkflowArtifactQuery
 * @property {string} repository
 * @property {string} name
 * @property {string} token
 * @property {typeof fetch | undefined} [fetchImpl]
 */
/** @typedef {(query: WorkflowRunQuery) => Promise<any[]>} WorkflowRunLister */
/** @typedef {(query: WorkflowArtifactQuery) => Promise<any[]>} WorkflowArtifactLister */

/** @param {string} path */
export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** @param {string} path */
export function resolveSafeEvidencePath(path) {
  if (typeof path !== "string" || !SAFE_TEST_RESULTS_PATH.test(path) || path.includes("..")) {
    throw new Error("unsafe_soak_evidence_path");
  }
  return resolve(path);
}

/** @param {string} path @returns {JsonRecord} */
export function readSafePrivateJson(path) {
  const resolved = resolveSafeEvidencePath(path);
  const stats = lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600) {
    throw new Error("unsafe_soak_evidence_file");
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("unsafe_soak_evidence_file");
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    throw new Error("invalid_soak_evidence_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_soak_evidence_json");
  }
  return parsed;
}

/** @param {JsonRecord} manifest */
export function validateGateBManifest(manifest) {
  const config = manifest?.postflight?.launchConfig;
  if (
    manifest?.schemaVersion !== 3 ||
    manifest?.status !== "passed" ||
    manifest?.strict !== true ||
    !SHA256.test(manifest?.candidateFingerprint ?? "") ||
    !config ||
    !SHA256.test(config.wranglerWorktreeSha256 ?? "") ||
    config.productionSearchRolloutMode !== "v2" ||
    config.providerNetworkDeny !== true ||
    config.retries !== 0 ||
    config.workers !== 1 ||
    JSON.stringify(manifest?.postflight?.journeys) !== JSON.stringify([1, 2, 3, 4, 5, 6]) ||
    manifest?.postflight?.isolatedPersistenceRemoved !== true
  ) {
    throw new Error("gate_b_manifest_not_release_safe");
  }
  return {
    candidateFingerprint: manifest.candidateFingerprint,
    wranglerWorktreeSha256: config.wranglerWorktreeSha256,
  };
}

/** @param {JsonRecord} journal @param {string} workerVersionId */
export function validateImmediateGateCJournal(journal, workerVersionId) {
  if (
    journal?.schemaVersion !== 1 ||
    journal?.workerVersionId !== workerVersionId ||
    journal?.searchRolloutMode !== "v2" ||
    journal?.status !== "passed" ||
    !Array.isArray(journal?.errors) ||
    journal.errors.length !== 0 ||
    !journal?.steps ||
    REQUIRED_GATE_C_STEPS.some((step) => journal.steps[step]?.status !== "passed")
  ) {
    throw new Error("immediate_gate_c_not_passed");
  }
}

/**
 * @param {{
 *   manifestPath: string,
 *   wranglerOutputPath: string,
 *   gateCPath: string,
 *   rollbackTargetPath: string,
 *   now?: Date,
 *   headCommit: string,
 *   deploymentWorkflowRunId: number,
 *   deploymentWorkflowRunAttempt: number,
 * }} input
 */
export function buildRunningSoakJournal({
  manifestPath,
  wranglerOutputPath,
  gateCPath,
  rollbackTargetPath,
  now = new Date(),
  headCommit,
  deploymentWorkflowRunId,
  deploymentWorkflowRunAttempt,
}) {
  const manifest = readSafePrivateJson(manifestPath);
  const gateB = validateGateBManifest(manifest);
  const wranglerPath = resolveSafeEvidencePath(wranglerOutputPath);
  const wranglerStats = lstatSync(wranglerPath);
  if (!wranglerStats.isFile() || wranglerStats.isSymbolicLink()) throw new Error("unsafe_wrangler_output_file");
  const workerVersionId = readDeployedWorkerVersionId(readFileSync(wranglerPath, "utf8"));
  if (!SAFE_VERSION.test(workerVersionId)) throw new Error("unsafe_worker_version");
  const gateC = readSafePrivateJson(gateCPath);
  validateImmediateGateCJournal(gateC, workerVersionId);
  // Bind the rollback-target evidence into the journal (path + sha256) so the
  // release-evidence archive can verify it the same way it verifies the
  // manifest / wrangler / gate-C references, rather than trusting an unbound,
  // possibly-forged or duplicated worker-rollback-target file.
  if (typeof rollbackTargetPath !== "string" || !rollbackTargetPath.trim()) {
    throw new Error("soak_rollback_target_path_missing");
  }
  const rollbackPath = resolveSafeEvidencePath(rollbackTargetPath);
  const rollbackStats = lstatSync(rollbackPath);
  if (!rollbackStats.isFile() || rollbackStats.isSymbolicLink()) throw new Error("unsafe_rollback_target_file");
  if (!/^[a-f0-9]{40}$/u.test(headCommit ?? "")) throw new Error("unsafe_soak_head_commit");
  if (
    !Number.isSafeInteger(deploymentWorkflowRunId) || deploymentWorkflowRunId <= 0 ||
    !Number.isSafeInteger(deploymentWorkflowRunAttempt) || deploymentWorkflowRunAttempt <= 0
  ) throw new Error("unsafe_deployment_workflow_identity");
  const startedAt = new Date(now);
  const endedAt = new Date(startedAt.getTime() + GATE_C_SOAK_DURATION_MS);
  return {
    schemaVersion: GATE_C_SOAK_SCHEMA_VERSION,
    kind: "gate-c-exact-worker-scheduled-soak",
    status: "running",
    generatedAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
    completedAt: null,
    candidate: {
      headCommit,
      candidateFingerprint: gateB.candidateFingerprint,
      wranglerWorktreeSha256: gateB.wranglerWorktreeSha256,
      gateBManifestPath: manifestPath,
      gateBManifestSha256: sha256File(resolveSafeEvidencePath(manifestPath)),
    },
    deployment: {
      workerVersionId,
      searchRolloutMode: "v2",
      githubWorkflowRunId: deploymentWorkflowRunId,
      githubWorkflowRunAttempt: deploymentWorkflowRunAttempt,
      wranglerOutputPath,
      wranglerOutputSha256: sha256File(wranglerPath),
      immediateGateCPath: gateCPath,
      immediateGateCSha256: sha256File(resolveSafeEvidencePath(gateCPath)),
      workerRollbackTargetPath: rollbackTargetPath,
      workerRollbackTargetSha256: sha256File(rollbackPath),
    },
    window: {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      finalizeNotBeforeAt: new Date(endedAt.getTime() + GATE_C_SOAK_SETTLE_MS).toISOString(),
      finalizeDeadlineAt: new Date(endedAt.getTime() + GATE_C_SOAK_FINALIZE_GRACE_MS).toISOString(),
      durationMs: GATE_C_SOAK_DURATION_MS,
    },
    thresholds: {
      taskDurationMs: 15 * 60 * 1000,
      failures: 0,
      degraded: 0,
      duplicateAttempts: 0,
      uptimeMinSamples: GATE_C_UPTIME_MIN_SAMPLES,
      uptimeMaxGapMs: GATE_C_UPTIME_MAX_GAP_MS,
    },
    final: null,
    errors: [],
  };
}

/** @param {JsonRecord} journal */
function validateSoakJournalIdentityAndReferences(journal) {
  if (
    journal?.schemaVersion !== GATE_C_SOAK_SCHEMA_VERSION ||
    journal?.kind !== "gate-c-exact-worker-scheduled-soak" ||
    journal?.status !== "running" ||
    journal?.deployment?.searchRolloutMode !== "v2" ||
    !SAFE_VERSION.test(journal?.deployment?.workerVersionId ?? "") ||
    !Number.isSafeInteger(journal?.deployment?.githubWorkflowRunId) ||
    journal.deployment.githubWorkflowRunId <= 0 ||
    !Number.isSafeInteger(journal?.deployment?.githubWorkflowRunAttempt) ||
    journal.deployment.githubWorkflowRunAttempt <= 0 ||
    !SHA256.test(journal?.candidate?.candidateFingerprint ?? "") ||
    !SHA256.test(journal?.candidate?.wranglerWorktreeSha256 ?? "") ||
    !SHA256.test(journal?.candidate?.gateBManifestSha256 ?? "") ||
    !SHA256.test(journal?.deployment?.wranglerOutputSha256 ?? "") ||
    !SHA256.test(journal?.deployment?.immediateGateCSha256 ?? "") ||
    typeof journal?.deployment?.workerRollbackTargetPath !== "string" ||
    !SHA256.test(journal?.deployment?.workerRollbackTargetSha256 ?? "") ||
    !/^[a-f0-9]{40}$/u.test(journal?.candidate?.headCommit ?? "") ||
    journal?.window?.durationMs !== GATE_C_SOAK_DURATION_MS ||
    journal?.thresholds?.taskDurationMs !== 15 * 60 * 1000 ||
    journal?.thresholds?.failures !== 0 ||
    journal?.thresholds?.degraded !== 0 ||
    journal?.thresholds?.duplicateAttempts !== 0 ||
    journal?.thresholds?.uptimeMinSamples !== GATE_C_UPTIME_MIN_SAMPLES ||
    journal?.thresholds?.uptimeMaxGapMs !== GATE_C_UPTIME_MAX_GAP_MS ||
    journal?.completedAt !== null ||
    journal?.final !== null ||
    !Array.isArray(journal?.errors) ||
    journal.errors.length !== 0
  ) throw new Error("invalid_running_soak_journal");

  const generatedAt = Date.parse(journal.generatedAt);
  const startedAt = Date.parse(journal.window.startedAt);
  const endedAt = Date.parse(journal.window.endedAt);
  const finalizeNotBefore = Date.parse(journal.window.finalizeNotBeforeAt);
  const deadline = Date.parse(journal.window.finalizeDeadlineAt);
  if (
    !Number.isFinite(generatedAt) || !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) || !Number.isFinite(finalizeNotBefore) || !Number.isFinite(deadline) ||
    generatedAt !== startedAt ||
    endedAt - startedAt !== GATE_C_SOAK_DURATION_MS ||
    finalizeNotBefore - endedAt !== GATE_C_SOAK_SETTLE_MS ||
    deadline - endedAt !== GATE_C_SOAK_FINALIZE_GRACE_MS
  ) {
    throw new Error("invalid_soak_window");
  }

  const referenced = [
    [journal.candidate.gateBManifestPath, journal.candidate.gateBManifestSha256],
    [journal.deployment.wranglerOutputPath, journal.deployment.wranglerOutputSha256],
    [journal.deployment.immediateGateCPath, journal.deployment.immediateGateCSha256],
    [journal.deployment.workerRollbackTargetPath, journal.deployment.workerRollbackTargetSha256],
  ];
  for (const [path, expectedHash] of referenced) {
    if (sha256File(resolveSafeEvidencePath(path)) !== expectedHash) throw new Error("soak_referenced_evidence_drift");
  }
  const manifest = readSafePrivateJson(journal.candidate.gateBManifestPath);
  const gateB = validateGateBManifest(manifest);
  if (
    gateB.candidateFingerprint !== journal.candidate.candidateFingerprint ||
    gateB.wranglerWorktreeSha256 !== journal.candidate.wranglerWorktreeSha256
  ) throw new Error("soak_candidate_identity_drift");
  const workerVersionId = readDeployedWorkerVersionId(
    readFileSync(resolveSafeEvidencePath(journal.deployment.wranglerOutputPath), "utf8"),
  );
  if (workerVersionId !== journal.deployment.workerVersionId) throw new Error("soak_worker_identity_drift");
  validateImmediateGateCJournal(
    readSafePrivateJson(journal.deployment.immediateGateCPath),
    workerVersionId,
  );
  return { startedAt, endedAt, finalizeNotBefore, deadline };
}

/** @param {JsonRecord} journal @param {Date} [now] */
export function validateStartedSoakJournal(journal, now = new Date()) {
  const window = validateSoakJournalIdentityAndReferences(journal);
  if (now.getTime() < window.startedAt || now.getTime() >= window.endedAt) {
    throw new Error("soak_not_actively_running");
  }
  return journal;
}

/** @param {JsonRecord} journal @param {Date} [now] */
export function validateRunningSoakJournal(journal, now = new Date()) {
  const window = validateSoakJournalIdentityAndReferences(journal);
  if (now.getTime() < window.finalizeNotBefore) throw new Error("soak_window_incomplete");
  if (now.getTime() > window.deadline) throw new Error("soak_finalize_deadline_missed");
  return journal;
}

/** @param {unknown} value */
function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** @param {unknown} value */
function parseRunTime(value) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** @param {unknown} value */
function safeNonNegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
}

/** @param {unknown} value */
function safeMetricRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, metric]) =>
    /^[A-Za-z][A-Za-z0-9]{0,39}$/u.test(key) &&
    (typeof metric === "boolean" || safeNonNegativeInteger(metric))
  );
}

/** @param {unknown} payload @param {JsonRecord} journal @returns {JsonRecord} */
export function validateReleaseSoakPayload(payload, journal) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("soak_probe_invalid_payload");
  }
  const value = /** @type {JsonRecord} */ (payload);
  const observations = Array.isArray(value.observations) ? value.observations : null;
  const scheduled = value.scheduledRuns;
  const digest = value.digestJobs;
  const window = value.window;
  const slo = value.slo;
  const startedAtMs = Date.parse(journal.window.startedAt);
  const endedAtMs = Date.parse(journal.window.endedAt);
  const expectedSchedule = expectedReleaseSchedule(startedAtMs, endedAtMs);
  const expectedObservationKeys = new Set(expectedSchedule.map(releaseObservationKey));
  if (
    value.ok !== true || value.passed !== true || value.schemaVersion !== 1 ||
    value.evidenceClass !== "exact_worker_scheduled_observation" ||
    value.workerVersionId !== journal.deployment.workerVersionId ||
    value.searchRolloutMode !== "v2" ||
    !window || window.startedAt !== journal.window.startedAt || window.endedAt !== journal.window.endedAt ||
    window.durationMs !== GATE_C_SOAK_DURATION_MS ||
    !slo || slo.maxTaskDurationMs !== GATE_C_MAX_TASK_DURATION_MS ||
    slo.maxScheduledRunCompletionMs !== GATE_C_MAX_SCHEDULED_RUN_COMPLETION_MS ||
    slo.maxDigestJobCompletionMs !== GATE_C_MAX_DIGEST_JOB_COMPLETION_MS ||
    slo.failures !== 0 || slo.degraded !== 0 || slo.duplicateAttempts !== 0 ||
    !Array.isArray(value.blockers) || value.blockers.length !== 0 ||
    !observations || value.expectedObservations !== expectedSchedule.length ||
    value.observedObservations !== value.expectedObservations ||
    observations.length !== value.expectedObservations ||
    !safeNonNegativeInteger(value.maxTaskDurationMs) || value.maxTaskDurationMs > GATE_C_MAX_TASK_DURATION_MS ||
    !safeNonNegativeInteger(value.regularScanSuccesses) || value.regularScanSuccesses <= 0 ||
    !safeNonNegativeInteger(value.dailyDigestSuccesses) || value.dailyDigestSuccesses <= 0 ||
    !scheduled || !digest
  ) throw new Error("soak_probe_invalid_payload");

  const observationKeys = new Set();
  let observedMaxDurationMs = 0;
  let observedRegularScanSuccesses = 0;
  let observedDailyDigestSuccesses = 0;
  for (const entry of observations) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("soak_probe_invalid_payload");
    const observation = /** @type {JsonRecord} */ (entry);
    const scheduledAt = parseRunTime(observation.scheduledAt);
    const key = releaseObservationKey(observation);
    if (
      !["17 */6 * * *", "0 */3 * * *", "0 4 * * *", "0 5 * * MON"].includes(observation.cron) ||
      !SAFE_RELEASE_TASK_NAMES.has(observation.taskName) ||
      scheduledAt === null || scheduledAt < startedAtMs || scheduledAt >= endedAtMs ||
      !safeNonNegativeInteger(observation.durationMs) || observation.durationMs > GATE_C_MAX_TASK_DURATION_MS ||
      !["completed", "no_work"].includes(observation.outcome) || !safeMetricRecord(observation.metrics) ||
      observationKeys.has(key)
    ) throw new Error("soak_probe_invalid_payload");
    observationKeys.add(key);
    observedMaxDurationMs = Math.max(observedMaxDurationMs, observation.durationMs);
    if (observation.cron === "0 */3 * * *" && observation.taskName === "scheduled_monitoring") {
      observedRegularScanSuccesses += Number(observation.metrics.queued ?? 0) + Number(observation.metrics.inlineRuns ?? 0);
    }
    if (observation.cron === "0 4 * * *" && observation.taskName === "scheduled_monitoring") {
      observedDailyDigestSuccesses += Number(observation.metrics.digests ?? 0);
    }
  }
  if (
    observationKeys.size !== expectedObservationKeys.size ||
    [...expectedObservationKeys].some((key) => !observationKeys.has(key)) ||
    observedMaxDurationMs !== value.maxTaskDurationMs ||
    observedRegularScanSuccesses !== value.regularScanSuccesses ||
    observedDailyDigestSuccesses !== value.dailyDigestSuccesses
  ) throw new Error("soak_probe_invalid_payload");

  const scheduledValues = [
    scheduled.totalRuns, scheduled.succeededRuns, scheduled.failedRuns, scheduled.pendingRuns,
    scheduled.runningRuns, scheduled.skippedRuns, scheduled.degradedRuns, scheduled.maxCompletionMs,
  ];
  const digestValues = [
    digest.totalJobs, digest.completedJobs, digest.failedJobs, digest.pendingJobs, digest.runningJobs,
    digest.exhaustedJobs, digest.retriedJobs, digest.deliveryAttempts, digest.sentDeliveryAttempts,
    digest.unresolvedDeliveryAttempts, digest.maxCompletionMs,
  ];
  if (
    !scheduledValues.every(safeNonNegativeInteger) || !digestValues.every(safeNonNegativeInteger) ||
    scheduled.totalRuns <= 0 || scheduled.succeededRuns !== scheduled.totalRuns ||
    scheduled.totalRuns !== value.regularScanSuccesses ||
    scheduled.failedRuns !== 0 || scheduled.pendingRuns !== 0 || scheduled.runningRuns !== 0 ||
    scheduled.skippedRuns !== 0 || scheduled.degradedRuns !== 0 ||
    scheduled.maxCompletionMs > GATE_C_MAX_SCHEDULED_RUN_COMPLETION_MS ||
    digest.totalJobs <= 0 || digest.completedJobs !== digest.totalJobs ||
    digest.failedJobs !== 0 || digest.pendingJobs !== 0 || digest.runningJobs !== 0 ||
    digest.exhaustedJobs !== 0 || digest.retriedJobs !== 0 || digest.deliveryAttempts <= 0 ||
    digest.sentDeliveryAttempts !== digest.deliveryAttempts || digest.unresolvedDeliveryAttempts !== 0 ||
    digest.maxCompletionMs > GATE_C_MAX_DIGEST_JOB_COMPLETION_MS
  ) throw new Error("soak_probe_invalid_payload");
  return value;
}

/**
 * @param {any[]} runs
 * @param {{ startedAtMs: number, endedAtMs: number, expectedHead: string }} input
 */
export function evaluateUptimeWorkflowRuns(runs, input) {
  const blockers = new Set();
  const byId = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    const id = Number(run?.id);
    const createdAt = parseRunTime(run?.created_at);
    if (!Number.isSafeInteger(id) || id <= 0 || createdAt === null) {
      blockers.add("uptime_run_shape_invalid");
      continue;
    }
    if (byId.has(id)) blockers.add("uptime_run_identity_duplicate");
    byId.set(id, {
      id,
      createdAt,
      headSha: run.head_sha,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      attempt: run.run_attempt,
    });
  }
  const selected = [...byId.values()].filter((run) =>
    run.createdAt >= input.startedAtMs && run.createdAt <= input.endedAtMs + GATE_C_SOAK_SETTLE_MS
  );
  if (selected.length < GATE_C_UPTIME_MIN_SAMPLES) blockers.add("uptime_sample_coverage_failed");
  for (const run of selected) {
    if (run.event !== "schedule") blockers.add("uptime_run_event_invalid");
    if (run.headSha !== input.expectedHead) blockers.add("uptime_candidate_head_drift");
    if (run.status !== "completed" || run.conclusion !== "success") blockers.add("uptime_run_failed");
    if (run.attempt !== 1) blockers.add("uptime_run_retried");
  }
  const points = [
    input.startedAtMs,
    ...selected.map((run) => Math.min(run.createdAt, input.endedAtMs)),
    input.endedAtMs,
  ].sort((left, right) => left - right);
  let maxGapMs = 0;
  for (let index = 1; index < points.length; index += 1) {
    maxGapMs = Math.max(maxGapMs, points[index] - points[index - 1]);
  }
  if (maxGapMs > GATE_C_UPTIME_MAX_GAP_MS) blockers.add("uptime_observation_gap_failed");
  const canonicalRuns = selected
    .map((run) => ({
      id: run.id,
      createdAt: new Date(run.createdAt).toISOString(),
      headSha: run.headSha,
      conclusion: run.conclusion,
      attempt: run.attempt,
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id);
  return {
    passed: blockers.size === 0,
    blockers: [...blockers].sort(),
    observedSamples: selected.length,
    minimumSamples: GATE_C_UPTIME_MIN_SAMPLES,
    maxGapMs,
    allowedMaxGapMs: GATE_C_UPTIME_MAX_GAP_MS,
    firstObservedAt: canonicalRuns[0]?.createdAt ?? null,
    lastObservedAt: canonicalRuns.at(-1)?.createdAt ?? null,
    observedRunIds: canonicalRuns.map((run) => run.id),
    runSetSha256: sha256Json(canonicalRuns),
  };
}

/** @param {WorkflowRunQuery} input */
async function listWorkflowRuns({ repository, workflow, event, startedAt, endedAt, token, fetchImpl = fetch }) {
  /** @type {any[]} */
  const runs = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs`);
    if (event) url.searchParams.set("event", event);
    if (startedAt && endedAt) url.searchParams.set("created", `${startedAt}..${endedAt}`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    /** @type {Record<string, string>} */
    const headers = {
      accept: "application/vnd.github+json",
      "user-agent": "0509-gate-c-soak",
      "x-github-api-version": "2022-11-28",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(url, { headers, redirect: "error" });
    if (!response.ok) throw new Error("github_workflow_runs_unavailable");
    const payload = await response.json();
    if (!Array.isArray(payload?.workflow_runs)) throw new Error("github_workflow_runs_invalid");
    runs.push(...payload.workflow_runs);
    if (payload.workflow_runs.length < 100) break;
    if (page === 10) throw new Error("github_workflow_runs_pagination_exceeded");
  }
  return runs;
}

/** @param {WorkflowArtifactQuery} input */
async function listWorkflowArtifacts({ repository, name, token, fetchImpl = fetch }) {
  /** @type {any[]} */
  const artifacts = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repository}/actions/artifacts`);
    url.searchParams.set("name", name);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    /** @type {Record<string, string>} */
    const headers = {
      accept: "application/vnd.github+json",
      "user-agent": "0509-gate-c-soak",
      "x-github-api-version": "2022-11-28",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(url, { headers, redirect: "error" });
    if (!response.ok) throw new Error("github_workflow_artifacts_unavailable");
    const payload = await response.json();
    if (!Array.isArray(payload?.artifacts)) throw new Error("github_workflow_artifacts_invalid");
    artifacts.push(...payload.artifacts);
    if (payload.artifacts.length < 100) break;
    if (page === 10) throw new Error("github_workflow_artifacts_pagination_exceeded");
  }
  return artifacts;
}

/**
 * @param {JsonRecord} journal
 * @param {{
 *   repository?: string,
 *   token?: string,
 *   now?: Date | number | string,
 *   listWorkflowRuns?: WorkflowRunLister,
 *   listWorkflowArtifacts?: WorkflowArtifactLister,
 *   fetchImpl?: typeof fetch,
 * }} [dependencies]
 */
export async function collectGitHubSoakEvidence(journal, dependencies = {}) {
  const repository = dependencies.repository ?? process.env.GITHUB_REPOSITORY ?? "Nishfleet/0509";
  // The repository was renamed from nish3451/0509 to Nishfleet/0509; accept
  // either canonical name so the soak collector runs under both locally and
  // in CI regardless of which GITHUB_REPOSITORY the runner reports.
  if (repository !== "nish3451/0509" && repository !== "Nishfleet/0509") throw new Error("github_soak_repository_invalid");
  const token = dependencies.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  const startedAt = journal.window.startedAt;
  const endedAt = new Date(Date.parse(journal.window.endedAt) + GATE_C_SOAK_SETTLE_MS).toISOString();
  const collectedAt = new Date(dependencies.now ?? Date.now());
  if (!Number.isFinite(collectedAt.getTime())) throw new Error("github_soak_collection_time_invalid");
  const listRuns = dependencies.listWorkflowRuns ?? listWorkflowRuns;
  const uptimeRuns = await listRuns({
    repository,
    workflow: "uptime-health.yml",
    event: "schedule",
    startedAt,
    endedAt,
    token,
    fetchImpl: dependencies.fetchImpl,
  });
  const uptime = evaluateUptimeWorkflowRuns(uptimeRuns, {
    startedAtMs: Date.parse(journal.window.startedAt),
    endedAtMs: Date.parse(journal.window.endedAt),
    expectedHead: journal.candidate.headCommit,
  });
  const expectedArtifactName = `uptime-worker-${journal.deployment.workerVersionId}`;
  const listArtifacts = dependencies.listWorkflowArtifacts ?? listWorkflowArtifacts;
  const workerArtifacts = await listArtifacts({
    repository,
    name: expectedArtifactName,
    token,
    fetchImpl: dependencies.fetchImpl,
  });
  const expectedRunIds = new Set(uptime.observedRunIds);
  /** @type {Map<number, Array<{ id: number, runId: number, createdAt: string }>>} */
  const artifactsByRun = new Map();
  let invalidWorkerArtifacts = 0;
  for (const artifact of Array.isArray(workerArtifacts) ? workerArtifacts : []) {
    const id = Number(artifact?.id);
    const runId = Number(artifact?.workflow_run?.id);
    const createdAt = parseRunTime(artifact?.created_at);
    if (
      !Number.isSafeInteger(id) || id <= 0 ||
      !Number.isSafeInteger(runId) || runId <= 0 ||
      createdAt === null || artifact?.name !== expectedArtifactName ||
      artifact?.expired === true
    ) {
      invalidWorkerArtifacts += 1;
      continue;
    }
    if (!expectedRunIds.has(runId)) continue;
    const entries = artifactsByRun.get(runId) ?? [];
    entries.push({ id, runId, createdAt: new Date(createdAt).toISOString() });
    artifactsByRun.set(runId, entries);
  }
  const deployRuns = await listRuns({
    repository,
    workflow: "deploy-production.yml",
    event: null,
    startedAt: null,
    endedAt: null,
    token,
    fetchImpl: dependencies.fetchImpl,
  });
  const startedAtMs = Date.parse(startedAt);
  const collectedAtMs = collectedAt.getTime();
  let invalidDeployRuns = 0;
  let laterDeployAttempts = 0;
  for (const run of Array.isArray(deployRuns) ? deployRuns : []) {
    const id = Number(run?.id);
    const attempt = Number(run?.run_attempt);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(attempt) || attempt <= 0) {
      invalidDeployRuns += 1;
      continue;
    }
    const runStartedAt = parseRunTime(run?.run_started_at);
    const createdAt = parseRunTime(run?.created_at);
    const attemptStartedAt = runStartedAt ?? (attempt === 1 ? createdAt : null);
    if (attemptStartedAt === null) {
      invalidDeployRuns += 1;
      continue;
    }
    if (attemptStartedAt < startedAtMs || attemptStartedAt > collectedAtMs) continue;
    const isOriginalDeployment =
      id === journal.deployment.githubWorkflowRunId &&
      attempt === journal.deployment.githubWorkflowRunAttempt;
    if (!isOriginalDeployment) laterDeployAttempts += 1;
  }
  const blockers = [...uptime.blockers];
  if (invalidWorkerArtifacts > 0) blockers.push("uptime_worker_evidence_invalid");
  if (uptime.observedRunIds.some((runId) => !artifactsByRun.has(runId))) {
    blockers.push("uptime_worker_version_evidence_missing");
  }
  if ([...artifactsByRun.values()].some((entries) => entries.length !== 1)) {
    blockers.push("uptime_worker_version_evidence_duplicate");
  }
  if (invalidDeployRuns > 0) blockers.push("deployment_evidence_invalid");
  if (laterDeployAttempts > 0) blockers.push("deployment_drift_during_soak");
  return {
    ...uptime,
    repository,
    collectedAt: collectedAt.toISOString(),
    candidateHead: journal.candidate.headCommit,
    workflow: "uptime-health.yml",
    workerVersionId: journal.deployment.workerVersionId,
    observedWorkerArtifacts: artifactsByRun.size,
    workerArtifactSetSha256: sha256Json([...artifactsByRun.values()].flat().sort((left, right) => left.runId - right.runId)),
    laterDeployAttempts,
    passed: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
  };
}

/**
 * @param {JsonRecord} soakJournal
 * @param {JsonRecord} gateCJournal
 * @param {string} expectedRunId
 * @param {Date} [finalizedAt]
 */
export function validateFinalGateCForSoak(soakJournal, gateCJournal, expectedRunId, finalizedAt = new Date()) {
  validateImmediateGateCJournal(gateCJournal, soakJournal?.deployment?.workerVersionId);
  if (gateCJournal?.gateRunId !== expectedRunId) throw new Error("soak_final_gate_c_identity_mismatch");
  const endedAt = Date.parse(soakJournal?.window?.endedAt ?? "");
  const generatedAt = Date.parse(gateCJournal?.generatedAt ?? "");
  const completedAt = Date.parse(gateCJournal?.completedAt ?? "");
  const finalizedAtMs = finalizedAt.getTime();
  if (
    !Number.isFinite(endedAt) || !Number.isFinite(generatedAt) || !Number.isFinite(completedAt) ||
    generatedAt < endedAt || completedAt < generatedAt || completedAt > finalizedAtMs
  ) throw new Error("soak_final_gate_c_time_mismatch");
  return gateCJournal;
}
