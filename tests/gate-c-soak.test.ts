import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  GATE_C_SOAK_DURATION_MS,
  GATE_C_SOAK_SETTLE_MS,
  collectGitHubSoakEvidence,
  evaluateUptimeWorkflowRuns,
  buildRunningSoakJournal,
  validateFinalGateCForSoak,
  validateReleaseSoakPayload,
  validateRunningSoakJournal,
  validateStartedSoakJournal,
} from "../scripts/gate-c-soak.lib.mjs";
import {
  createReleaseEvidenceArchive,
  restoreReleaseEvidenceArchive,
} from "../scripts/release-evidence-archive.mjs";
import { expectedReleaseSchedule } from "../scripts/release-scheduled-observation-contract.mjs";

const roots: string[] = [];
const WORKER_VERSION = "worker-version-123";
const HEAD = "a".repeat(40);
const STARTED_AT = new Date("2026-07-18T00:00:00.000Z");
const DEPLOY_RUN_ID = 9001;
const DEPLOY_RUN_ATTEMPT = 1;

function privateJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function fixture() {
  mkdirSync(resolve("test-results"), { recursive: true });
  const root = mkdtempSync(resolve("test-results", "gate-c-soak-test-"));
  roots.push(root);
  const manifest = resolve(root, "manifest.json");
  const wrangler = resolve(root, "wrangler.jsonl");
  const gateC = resolve(root, "gate-c.json");
  privateJson(manifest, {
    schemaVersion: 3,
    status: "passed",
    strict: true,
    candidateFingerprint: "b".repeat(64),
    postflight: {
      launchConfig: {
        wranglerWorktreeSha256: "c".repeat(64),
        productionSearchRolloutMode: "shadow",
        providerNetworkDeny: true,
        retries: 0,
        workers: 1,
      },
      journeys: [1, 2, 3, 4, 5, 6],
      isolatedPersistenceRemoved: true,
    },
  });
  writeFileSync(wrangler, `${JSON.stringify({ type: "deploy", version: 1, version_id: WORKER_VERSION })}\n`, { mode: 0o600 });
  chmodSync(wrangler, 0o600);
  privateJson(gateC, {
    schemaVersion: 1,
    workerVersionId: WORKER_VERSION,
    searchRolloutMode: "shadow",
    status: "passed",
    errors: [],
    steps: Object.fromEntries([
      "identity_pre",
      "backup_lifecycle",
      "pricing",
      "billing",
      "proof_email",
      "production_meta",
      "proof_cleanup",
      "identity_post",
    ].map((step) => [step, { status: "passed" }])),
  });
  const repoRelative = (path: string) => relative(process.cwd(), path);
  return {
    manifest,
    gateC,
    journal: buildRunningSoakJournal({
      manifestPath: repoRelative(manifest),
      wranglerOutputPath: repoRelative(wrangler),
      gateCPath: repoRelative(gateC),
      now: STARTED_AT,
      headCommit: HEAD,
      deploymentWorkflowRunId: DEPLOY_RUN_ID,
      deploymentWorkflowRunAttempt: DEPLOY_RUN_ATTEMPT,
    }),
  };
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("Gate C scheduled-work soak journal", () => {
  it("binds the immutable candidate, deploy output, immediate Gate C, exact Worker, and exact 24-hour window", () => {
    const { journal } = fixture();
    expect(journal).toMatchObject({
      status: "running",
      candidate: { headCommit: HEAD, candidateFingerprint: "b".repeat(64) },
      deployment: {
        workerVersionId: WORKER_VERSION,
        searchRolloutMode: "shadow",
        githubWorkflowRunId: DEPLOY_RUN_ID,
        githubWorkflowRunAttempt: DEPLOY_RUN_ATTEMPT,
      },
      window: { startedAt: STARTED_AT.toISOString(), durationMs: GATE_C_SOAK_DURATION_MS },
      thresholds: { failures: 0, degraded: 0, duplicateAttempts: 0 },
    });
    expect(Date.parse(journal.window.endedAt) - Date.parse(journal.window.startedAt)).toBe(GATE_C_SOAK_DURATION_MS);
    expect(validateStartedSoakJournal(journal, new Date(STARTED_AT.getTime() + 1))).toBe(journal);
    expect(validateRunningSoakJournal(
      journal,
      new Date(STARTED_AT.getTime() + GATE_C_SOAK_DURATION_MS + GATE_C_SOAK_SETTLE_MS),
    )).toBe(journal);
  });

  it("rejects premature/late finalization and tampered window or thresholds", () => {
    const { journal } = fixture();
    expect(() => validateRunningSoakJournal(journal, STARTED_AT)).toThrow("soak_window_incomplete");
    expect(() => validateRunningSoakJournal(
      journal,
      new Date(STARTED_AT.getTime() + 36 * 60 * 60 * 1000 + 1),
    )).toThrow("soak_finalize_deadline_missed");

    const shortened = structuredClone(journal);
    shortened.window.endedAt = new Date(STARTED_AT.getTime() + 23 * 60 * 60 * 1000).toISOString();
    expect(() => validateRunningSoakJournal(shortened, new Date(shortened.window.endedAt))).toThrow("invalid_soak_window");

    const weakened = structuredClone(journal);
    weakened.thresholds.failures = 1;
    expect(() => validateRunningSoakJournal(
      weakened,
      new Date(STARTED_AT.getTime() + GATE_C_SOAK_DURATION_MS + GATE_C_SOAK_SETTLE_MS),
    )).toThrow("invalid_running_soak_journal");
  });

  it("fails closed when any referenced candidate or deploy evidence drifts", () => {
    const { journal, manifest } = fixture();
    privateJson(manifest, { drifted: true });
    expect(() => validateRunningSoakJournal(
      journal,
      new Date(STARTED_AT.getTime() + GATE_C_SOAK_DURATION_MS + GATE_C_SOAK_SETTLE_MS),
    )).toThrow("soak_referenced_evidence_drift");
  });

  it("requires dense successful non-retried uptime runs on the exact candidate and no later deploy", async () => {
    const { journal } = fixture();
    const runs = Array.from({ length: 288 }, (_, index) => ({
      id: index + 1,
      created_at: new Date(STARTED_AT.getTime() + 2 * 60_000 + index * 5 * 60_000).toISOString(),
      head_sha: HEAD,
      event: "schedule",
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
    }));
    const artifacts = runs.map((run, index) => ({
      id: index + 10_000,
      name: `uptime-worker-${WORKER_VERSION}`,
      expired: false,
      created_at: run.created_at,
      workflow_run: { id: run.id },
    }));
    const evaluation = evaluateUptimeWorkflowRuns(runs, {
      startedAtMs: STARTED_AT.getTime(),
      endedAtMs: STARTED_AT.getTime() + GATE_C_SOAK_DURATION_MS,
      expectedHead: HEAD,
    });
    expect(evaluation).toMatchObject({ passed: true, blockers: [], observedSamples: 288 });

    const failed = runs.map((run) => ({ ...run }));
    failed[10]!.conclusion = "failure";
    expect(evaluateUptimeWorkflowRuns(failed, {
      startedAtMs: STARTED_AT.getTime(),
      endedAtMs: STARTED_AT.getTime() + GATE_C_SOAK_DURATION_MS,
      expectedHead: HEAD,
    }).blockers).toContain("uptime_run_failed");

    const listWorkflowRuns = async ({ workflow }: { workflow: string }) =>
      workflow === "uptime-health.yml" ? runs : [];
    const listWorkflowArtifacts = async () => artifacts;
    const collectionTime = new Date(Date.parse(journal.window.endedAt) + GATE_C_SOAK_SETTLE_MS);
    const collected = await collectGitHubSoakEvidence(journal, {
      listWorkflowRuns,
      listWorkflowArtifacts,
      now: collectionTime,
    });
    expect(collected.passed).toBe(true);
    expect(collected.laterDeployAttempts).toBe(0);
    expect(collected.observedWorkerArtifacts).toBe(288);

    const withDeploy = await collectGitHubSoakEvidence(journal, {
      listWorkflowRuns: async ({ workflow }: { workflow: string }) => workflow === "uptime-health.yml"
        ? runs
        : [{
            id: 9002,
            run_attempt: 1,
            created_at: journal.window.startedAt,
            run_started_at: journal.window.startedAt,
            updated_at: journal.window.startedAt,
          }],
      listWorkflowArtifacts,
      now: collectionTime,
    });
    expect(withDeploy.blockers).toContain("deployment_drift_during_soak");

    const withFailedDeploy = await collectGitHubSoakEvidence(journal, {
      listWorkflowRuns: async ({ workflow }: { workflow: string }) => workflow === "uptime-health.yml"
        ? runs
        : [{
            id: 9003,
            run_attempt: 1,
            created_at: "2026-07-18T03:00:00.000Z",
            run_started_at: "2026-07-18T03:00:00.000Z",
            updated_at: "2026-07-18T03:01:00.000Z",
          }],
      listWorkflowArtifacts,
      now: collectionTime,
    });
    expect(withFailedDeploy.laterDeployAttempts).toBe(1);
    expect(withFailedDeploy.blockers).toContain("deployment_drift_during_soak");

    const withWorkerDrift = await collectGitHubSoakEvidence(journal, {
      listWorkflowRuns,
      listWorkflowArtifacts: async () => artifacts.slice(1),
      now: collectionTime,
    });
    expect(withWorkerDrift.blockers).toContain("uptime_worker_version_evidence_missing");

    const originalDeployment = await collectGitHubSoakEvidence(journal, {
      listWorkflowRuns: async ({ workflow }: { workflow: string }) => workflow === "uptime-health.yml"
        ? runs
        : [{
            id: DEPLOY_RUN_ID,
            run_attempt: DEPLOY_RUN_ATTEMPT,
            created_at: new Date(STARTED_AT.getTime() - 60_000).toISOString(),
            run_started_at: new Date(STARTED_AT.getTime() - 30_000).toISOString(),
            updated_at: new Date(STARTED_AT.getTime() + 60_000).toISOString(),
          }],
      listWorkflowArtifacts,
      now: collectionTime,
    });
    expect(originalDeployment.laterDeployAttempts).toBe(0);

    const preSoakDeploymentCompletedLate = await collectGitHubSoakEvidence(journal, {
      listWorkflowRuns: async ({ workflow }: { workflow: string }) => workflow === "uptime-health.yml"
        ? runs
        : [{
            id: 8000,
            run_attempt: 1,
            created_at: new Date(STARTED_AT.getTime() - 120_000).toISOString(),
            run_started_at: new Date(STARTED_AT.getTime() - 60_000).toISOString(),
            updated_at: new Date(STARTED_AT.getTime() + 60_000).toISOString(),
          }],
      listWorkflowArtifacts,
      now: collectionTime,
    });
    expect(preSoakDeploymentCompletedLate.laterDeployAttempts).toBe(0);

    const rerun = await collectGitHubSoakEvidence(journal, {
      listWorkflowRuns: async ({ workflow }: { workflow: string }) => workflow === "uptime-health.yml"
        ? runs
        : [{
            id: DEPLOY_RUN_ID,
            run_attempt: DEPLOY_RUN_ATTEMPT + 1,
            created_at: new Date(STARTED_AT.getTime() - 60_000).toISOString(),
            run_started_at: new Date(STARTED_AT.getTime() + 30_000).toISOString(),
            updated_at: new Date(STARTED_AT.getTime() + 60_000).toISOString(),
          }],
      listWorkflowArtifacts,
      now: collectionTime,
    });
    expect(rerun.blockers).toContain("deployment_drift_during_soak");

    const lateDeploy = await collectGitHubSoakEvidence(journal, {
      listWorkflowRuns: async ({ workflow }: { workflow: string }) => workflow === "uptime-health.yml"
        ? runs
        : [{
            id: 9004,
            run_attempt: 1,
            created_at: new Date(Date.parse(journal.window.endedAt) + 30 * 60_000).toISOString(),
            run_started_at: new Date(Date.parse(journal.window.endedAt) + 30 * 60_000).toISOString(),
            updated_at: new Date(Date.parse(journal.window.endedAt) + 31 * 60_000).toISOString(),
          }],
      listWorkflowArtifacts,
      now: new Date(Date.parse(journal.window.endedAt) + 60 * 60_000),
    });
    expect(lateDeploy.blockers).toContain("deployment_drift_during_soak");
  });

  it("accepts only a complete exact-window release-soak payload", () => {
    const { journal } = fixture();
    const buildPayload = (targetJournal: typeof journal) => {
      const expected = expectedReleaseSchedule(
        Date.parse(targetJournal.window.startedAt),
        Date.parse(targetJournal.window.endedAt),
      );
      const observations = expected.map((observation) => ({
        ...observation,
        durationMs: 1_000,
        outcome: "completed",
        metrics: observation.cron === "0 */3 * * *" && observation.taskName === "scheduled_monitoring"
          ? { queued: 1 }
          : observation.cron === "0 4 * * *" && observation.taskName === "scheduled_monitoring"
            ? { digests: 1 }
            : { attempted: 0 },
      }));
      const regularScanSuccesses = observations.filter((observation) =>
        observation.cron === "0 */3 * * *" && observation.taskName === "scheduled_monitoring"
      ).length;
      const dailyDigestSuccesses = observations.filter((observation) =>
        observation.cron === "0 4 * * *" && observation.taskName === "scheduled_monitoring"
      ).length;
      return {
        ok: true,
        passed: true,
        schemaVersion: 1,
        evidenceClass: "exact_worker_scheduled_observation",
        workerVersionId: WORKER_VERSION,
        searchRolloutMode: "shadow",
        window: {
          startedAt: targetJournal.window.startedAt,
          endedAt: targetJournal.window.endedAt,
          durationMs: GATE_C_SOAK_DURATION_MS,
        },
        slo: {
          maxTaskDurationMs: 15 * 60 * 1000,
          maxScheduledRunCompletionMs: 2 * 60 * 60 * 1000,
          maxDigestJobCompletionMs: 2 * 60 * 60 * 1000,
          failures: 0,
          degraded: 0,
          duplicateAttempts: 0,
        },
        blockers: [],
        expectedObservations: observations.length,
        observedObservations: observations.length,
        maxTaskDurationMs: 1_000,
        regularScanSuccesses,
        dailyDigestSuccesses,
        observations,
        scheduledRuns: {
          totalRuns: regularScanSuccesses,
          succeededRuns: regularScanSuccesses,
          failedRuns: 0,
          pendingRuns: 0,
          runningRuns: 0,
          skippedRuns: 0,
          degradedRuns: 0,
          maxCompletionMs: 60_000,
        },
        digestJobs: {
          totalJobs: dailyDigestSuccesses,
          completedJobs: dailyDigestSuccesses,
          failedJobs: 0,
          pendingJobs: 0,
          runningJobs: 0,
          exhaustedJobs: 0,
          retriedJobs: 0,
          deliveryAttempts: dailyDigestSuccesses,
          sentDeliveryAttempts: dailyDigestSuccesses,
          unresolvedDeliveryAttempts: 0,
          maxCompletionMs: 60_000,
        },
      };
    };
    const payload = buildPayload(journal);

    expect(validateReleaseSoakPayload(payload, journal)).toBe(payload);
    expect(() => validateReleaseSoakPayload({ ...payload, observations: undefined }, journal))
      .toThrow("soak_probe_invalid_payload");
    expect(() => validateReleaseSoakPayload({
      ...payload,
      digestJobs: { ...payload.digestJobs, unresolvedDeliveryAttempts: 1 },
    }, journal)).toThrow("soak_probe_invalid_payload");

    const shifted = structuredClone(payload);
    shifted.observations[0]!.scheduledAt = new Date(Date.parse(shifted.observations[0]!.scheduledAt) + 60_000).toISOString();
    expect(() => validateReleaseSoakPayload(shifted, journal)).toThrow("soak_probe_invalid_payload");

    const repeated = structuredClone(payload);
    repeated.observations[repeated.observations.length - 1] = structuredClone(repeated.observations[0]!);
    expect(() => validateReleaseSoakPayload(repeated, journal)).toThrow("soak_probe_invalid_payload");

    const wrongPairing = structuredClone(payload);
    wrongPairing.observations[0]!.taskName = "weekly_business_numbers";
    expect(() => validateReleaseSoakPayload(wrongPairing, journal)).toThrow("soak_probe_invalid_payload");

    const mondayJournal = structuredClone(journal);
    mondayJournal.window.startedAt = "2026-07-20T00:00:00.000Z";
    mondayJournal.window.endedAt = "2026-07-21T00:00:00.000Z";
    const mondayPayload = buildPayload(mondayJournal);
    expect(mondayPayload.expectedObservations).toBe(54);
    expect(validateReleaseSoakPayload(mondayPayload, mondayJournal)).toBe(mondayPayload);
    expect(() => validateReleaseSoakPayload({ ...mondayPayload, expectedObservations: 51 }, mondayJournal))
      .toThrow("soak_probe_invalid_payload");
  });

  it("accepts only a fresh independent eight-step Gate C generated after this soak ended", () => {
    const { journal } = fixture();
    const endedAt = journal.window.endedAt;
    const runId = "gate-c-worker-version-123-soak-final-window";
    const gateC = {
      schemaVersion: 1,
      workerVersionId: WORKER_VERSION,
      searchRolloutMode: "shadow",
      gateRunId: runId,
      generatedAt: endedAt,
      completedAt: new Date(Date.parse(endedAt) + 1_000).toISOString(),
      status: "passed",
      errors: [],
      steps: Object.fromEntries([
        "identity_pre",
        "backup_lifecycle",
        "pricing",
        "billing",
        "proof_email",
        "production_meta",
        "proof_cleanup",
        "identity_post",
      ].map((step) => [step, { status: "passed" }])),
    };
    expect(validateFinalGateCForSoak(
      journal,
      gateC,
      runId,
      new Date(Date.parse(endedAt) + 2_000),
    )).toBe(gateC);

    const stale = { ...gateC, generatedAt: new Date(Date.parse(endedAt) - 1).toISOString() };
    expect(() => validateFinalGateCForSoak(
      journal,
      stale,
      runId,
      new Date(Date.parse(endedAt) + 2_000),
    )).toThrow("soak_final_gate_c_time_mismatch");
    expect(() => validateFinalGateCForSoak(
      journal,
      gateC,
      `${runId}-other`,
      new Date(Date.parse(endedAt) + 2_000),
    )).toThrow("soak_final_gate_c_identity_mismatch");
  });

  it("round-trips private finalization evidence through a permission-preserving archive", () => {
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const manifest = `test-results/gate-b-manifest-${suffix}.json`;
    const wrangler = `test-results/wrangler-deploy-output-${suffix}.jsonl`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const evidence = `test-results/production-soak-${suffix}.json`;
    const readiness = `test-results/deploy-readiness-${suffix}.json`;
    const rollback = `test-results/worker-rollback-target-${suffix}.json`;
    const artifact = `test-results/gate-b-artifacts/${suffix}.json`;
    const archive = `test-results/production-release-evidence-${"d".repeat(40)}-123-1.tar.gz`;
    const evidencePaths = [manifest, wrangler, gateC, evidence, readiness, rollback, artifact];
    roots.push(...evidencePaths.map((path) => resolve(path)), resolve(archive));
    mkdirSync(resolve(dirname(artifact)), { recursive: true });
    privateJson(resolve(manifest), {
      schemaVersion: 3,
      status: "passed",
      strict: true,
      candidateFingerprint: "b".repeat(64),
      postflight: {
        launchConfig: {
          wranglerWorktreeSha256: "c".repeat(64),
          productionSearchRolloutMode: "shadow",
          providerNetworkDeny: true,
          retries: 0,
          workers: 1,
        },
        journeys: [1, 2, 3, 4, 5, 6],
        isolatedPersistenceRemoved: true,
      },
    });
    writeFileSync(resolve(wrangler), `${JSON.stringify({ type: "deploy", version: 1, version_id: WORKER_VERSION })}\n`, { mode: 0o600 });
    chmodSync(resolve(wrangler), 0o600);
    privateJson(resolve(gateC), {
      schemaVersion: 1,
      workerVersionId: WORKER_VERSION,
      searchRolloutMode: "shadow",
      status: "passed",
      errors: [],
      steps: Object.fromEntries([
        "identity_pre",
        "backup_lifecycle",
        "pricing",
        "billing",
        "proof_email",
        "production_meta",
        "proof_cleanup",
        "identity_post",
      ].map((step) => [step, { status: "passed" }])),
    });
    const journal = buildRunningSoakJournal({
      manifestPath: manifest,
      wranglerOutputPath: wrangler,
      gateCPath: gateC,
      now: STARTED_AT,
      headCommit: HEAD,
      deploymentWorkflowRunId: DEPLOY_RUN_ID,
      deploymentWorkflowRunAttempt: DEPLOY_RUN_ATTEMPT,
    });
    privateJson(resolve(evidence), journal);
    privateJson(resolve(readiness), { status: "passed" });
    privateJson(resolve(rollback), { status: "passed" });
    privateJson(resolve(artifact), { status: "passed" });

    createReleaseEvidenceArchive({ archivePath: archive, evidencePaths });
    chmodSync(resolve(archive), 0o644);
    for (const path of evidencePaths) rmSync(resolve(path));
    const restored = restoreReleaseEvidenceArchive({ archivePath: archive });

    expect(restored.entries).toEqual([...evidencePaths].sort());
    for (const path of evidencePaths) expect(statSync(resolve(path)).mode & 0o777).toBe(0o600);
    expect(validateRunningSoakJournal(
      JSON.parse(readFileSync(resolve(evidence), "utf8")),
      new Date(STARTED_AT.getTime() + GATE_C_SOAK_DURATION_MS + GATE_C_SOAK_SETTLE_MS),
    )).toMatchObject({ status: "running", deployment: { workerVersionId: WORKER_VERSION } });
  });

  it("archives the real deploy layout where deploy-readiness IS the gate-b manifest (no standalone gate-b-manifest file)", () => {
    // Reproduces the first-ever live run of the archive step (deploy run
    // 29823981684): the production deploy pipeline writes the gate-b /
    // launch-readiness manifest to `deploy-readiness-<nonce>.json` (via
    // E2E_RELEASE_MANIFEST_PATH) and feeds that same path to
    // `gate-c-soak start --manifest`, so the soak journal's gateBManifestPath
    // points at the deploy-readiness file and NO standalone gate-b-manifest
    // file exists. The old REQUIRED_EVIDENCE mandated a separate
    // gate-b-manifest-*.json, so createReleaseEvidenceArchive threw
    // `release_evidence_set_incomplete` here. This fixture mirrors CI exactly.
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const readiness = `test-results/deploy-readiness-${suffix}.json`;
    const wrangler = `test-results/wrangler-deploy-output-${suffix}.jsonl`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const evidence = `test-results/production-soak-${suffix}.json`;
    const rollback = `test-results/worker-rollback-target-${suffix}.json`;
    const artifact = `test-results/gate-b-artifacts/${suffix}.json`;
    const archive = `test-results/production-release-evidence-${"a".repeat(40)}-126-1.tar.gz`;
    // Real deploy set: exactly one manifest file, and it is the deploy-readiness
    // manifest — no gate-b-manifest-*.json.
    const evidencePaths = [readiness, wrangler, gateC, evidence, rollback, artifact];
    roots.push(...evidencePaths.map((path) => resolve(path)), resolve(archive));
    mkdirSync(resolve(dirname(artifact)), { recursive: true });
    // The deploy-readiness file carries the schemaVersion-3 gate-b manifest.
    privateJson(resolve(readiness), {
      schemaVersion: 3,
      status: "passed",
      strict: true,
      candidateFingerprint: "b".repeat(64),
      postflight: {
        launchConfig: {
          wranglerWorktreeSha256: "c".repeat(64),
          productionSearchRolloutMode: "shadow",
          providerNetworkDeny: true,
          retries: 0,
          workers: 1,
        },
        journeys: [1, 2, 3, 4, 5, 6],
        isolatedPersistenceRemoved: true,
      },
    });
    writeFileSync(resolve(wrangler), `${JSON.stringify({ type: "deploy", version: 1, version_id: WORKER_VERSION })}\n`, { mode: 0o600 });
    chmodSync(resolve(wrangler), 0o600);
    privateJson(resolve(gateC), {
      schemaVersion: 1,
      workerVersionId: WORKER_VERSION,
      searchRolloutMode: "shadow",
      status: "passed",
      errors: [],
      steps: Object.fromEntries([
        "identity_pre",
        "backup_lifecycle",
        "pricing",
        "billing",
        "proof_email",
        "production_meta",
        "proof_cleanup",
        "identity_post",
      ].map((step) => [step, { status: "passed" }])),
    });
    // Journal binds the gate-b manifest to the deploy-readiness path, exactly as
    // the deploy pipeline does (gate-c-soak start --manifest <deploy-readiness>).
    const journal = buildRunningSoakJournal({
      manifestPath: readiness,
      wranglerOutputPath: wrangler,
      gateCPath: gateC,
      now: STARTED_AT,
      headCommit: HEAD,
      deploymentWorkflowRunId: DEPLOY_RUN_ID,
      deploymentWorkflowRunAttempt: DEPLOY_RUN_ATTEMPT,
    });
    expect(journal.candidate.gateBManifestPath).toBe(readiness);
    privateJson(resolve(evidence), journal);
    privateJson(resolve(rollback), { status: "passed" });
    privateJson(resolve(artifact), { status: "passed" });

    // Under the old code this threw release_evidence_set_incomplete.
    const created = createReleaseEvidenceArchive({ archivePath: archive, evidencePaths });
    expect(created.entries).not.toContainEqual(expect.stringMatching(/gate-b-manifest/u));
    expect(created.entries).toContain(readiness);
    chmodSync(resolve(archive), 0o644);
    for (const path of evidencePaths) rmSync(resolve(path));

    const restored = restoreReleaseEvidenceArchive({ archivePath: archive });
    expect(restored.entries).toEqual([...evidencePaths].sort());
    for (const path of evidencePaths) expect(statSync(resolve(path)).mode & 0o777).toBe(0o600);
  });

  it("rejects a nonempty but incomplete allowed evidence archive", () => {
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const archive = `test-results/production-release-evidence-${"e".repeat(40)}-124-1.tar.gz`;
    roots.push(resolve(gateC), resolve(archive));
    privateJson(resolve(gateC), { status: "passed" });
    execFileSync("tar", ["-czf", archive, "--", gateC]);

    expect(() => restoreReleaseEvidenceArchive({ archivePath: archive }))
      .toThrow("invalid_release_evidence_archive_entries");
  });

  it("rejects category-complete evidence missing the exact journal references", () => {
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const manifest = `test-results/gate-b-manifest-${suffix}.json`;
    const wrangler = `test-results/wrangler-deploy-output-${suffix}.jsonl`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const evidence = `test-results/production-soak-${suffix}.json`;
    const readiness = `test-results/deploy-readiness-${suffix}.json`;
    const rollback = `test-results/worker-rollback-target-${suffix}.json`;
    const artifact = `test-results/gate-b-artifacts/${suffix}.json`;
    const archive = `test-results/production-release-evidence-${"f".repeat(40)}-125-1.tar.gz`;
    const evidencePaths = [manifest, wrangler, gateC, evidence, readiness, rollback, artifact];
    roots.push(...evidencePaths.map((path) => resolve(path)), resolve(archive));
    mkdirSync(resolve(dirname(artifact)), { recursive: true });
    for (const path of [manifest, gateC, readiness, rollback, artifact]) privateJson(resolve(path), { status: "passed" });
    writeFileSync(resolve(wrangler), "{}\n", { mode: 0o600 });
    chmodSync(resolve(wrangler), 0o600);
    privateJson(resolve(evidence), {
      schemaVersion: 1,
      kind: "gate-c-exact-worker-scheduled-soak",
      status: "running",
      candidate: {
        gateBManifestPath: `test-results/gate-b-manifest-missing-${suffix}.json`,
        gateBManifestSha256: "0".repeat(64),
      },
      deployment: {
        wranglerOutputPath: wrangler,
        wranglerOutputSha256: "0".repeat(64),
        immediateGateCPath: gateC,
        immediateGateCSha256: "0".repeat(64),
      },
    });

    expect(() => createReleaseEvidenceArchive({ archivePath: archive, evidencePaths }))
      .toThrow("release_evidence_journal_reference_invalid");
    execFileSync("tar", ["-czf", archive, "--", ...evidencePaths]);
    expect(() => restoreReleaseEvidenceArchive({ archivePath: archive }))
      .toThrow("release_evidence_journal_reference_invalid");
  });
});
