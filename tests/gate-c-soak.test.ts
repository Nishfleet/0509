import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

// Writes a Gate-B artifact file and returns the {name,bytes,sha256} record the
// bound manifest must declare so the archive's integrity check accepts it.
function writeGateBArtifact(relPath: string, content: string) {
  writeFileSync(resolve(relPath), content, { mode: 0o600 });
  chmodSync(resolve(relPath), 0o600);
  return {
    name: relPath,
    bytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

// A worker-rollback-target payload that passes validateWorkerRollbackEvidence
// against the deployed WORKER_VERSION (a distinct prior version at 100%).
function validRollbackTarget() {
  return {
    schemaVersion: 1,
    deploymentId: "deployment-123",
    versionId: "worker-version-prior",
    percentage: 100,
    capturedAt: "2026-07-18T00:00:00.000Z",
    source: "wrangler deployments status --json",
  };
}

// A schemaVersion-3 Gate-B / deploy-readiness manifest that declares the given
// artifacts (so validateArtifactFiles has something to bind).
function gateBManifest(artifacts: Array<{ name: string; bytes: number; sha256: string }>) {
  return {
    schemaVersion: 3,
    status: "passed",
    strict: true,
    candidateFingerprint: "b".repeat(64),
    entries: [{ artifacts }],
    postflight: {
      launchConfig: {
        wranglerWorktreeSha256: "c".repeat(64),
        productionSearchRolloutMode: "v2",
        providerNetworkDeny: true,
        retries: 0,
        workers: 1,
      },
      journeys: [1, 2, 3, 4, 5, 6],
      isolatedPersistenceRemoved: true,
    },
  };
}

function passingGateCJournal() {
  return {
    schemaVersion: 1,
    workerVersionId: WORKER_VERSION,
    searchRolloutMode: "v2",
    status: "passed",
    errors: [],
    steps: Object.fromEntries(
      [
        "identity_pre",
        "backup_lifecycle",
        "pricing",
        "billing",
        "proof_email",
        "production_meta",
        "proof_cleanup",
        "identity_post",
      ].map((step) => [step, { status: "passed" }]),
    ),
  };
}

// Writes the non-manifest soak evidence (wrangler, valid rollback, gate-C) and a
// journal bound to an already-written readiness manifest. Returns the journal.
function writeBoundSoakEvidence(paths: {
  readiness: string;
  wrangler: string;
  gateC: string;
  rollback: string;
  evidence: string;
}) {
  writeFileSync(
    resolve(paths.wrangler),
    `${JSON.stringify({ type: "deploy", version: 1, version_id: WORKER_VERSION })}\n`,
    { mode: 0o600 },
  );
  chmodSync(resolve(paths.wrangler), 0o600);
  privateJson(resolve(paths.rollback), validRollbackTarget());
  privateJson(resolve(paths.gateC), passingGateCJournal());
  const journal = buildRunningSoakJournal({
    manifestPath: paths.readiness,
    wranglerOutputPath: paths.wrangler,
    gateCPath: paths.gateC,
    rollbackTargetPath: paths.rollback,
    now: STARTED_AT,
    headCommit: HEAD,
    deploymentWorkflowRunId: DEPLOY_RUN_ID,
    deploymentWorkflowRunAttempt: DEPLOY_RUN_ATTEMPT,
  });
  privateJson(resolve(paths.evidence), journal);
  return journal;
}

function fixture() {
  mkdirSync(resolve("test-results"), { recursive: true });
  const root = mkdtempSync(resolve("test-results", "gate-c-soak-test-"));
  roots.push(root);
  const manifest = resolve(root, "manifest.json");
  const wrangler = resolve(root, "wrangler.jsonl");
  const gateC = resolve(root, "gate-c.json");
  const rollback = resolve(root, "worker-rollback-target.json");
  privateJson(rollback, validRollbackTarget());
  privateJson(manifest, {
    schemaVersion: 3,
    status: "passed",
    strict: true,
    candidateFingerprint: "b".repeat(64),
    postflight: {
      launchConfig: {
        wranglerWorktreeSha256: "c".repeat(64),
        productionSearchRolloutMode: "v2",
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
    searchRolloutMode: "v2",
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
      rollbackTargetPath: repoRelative(rollback),
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
        searchRolloutMode: "v2",
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

  it("collects soak evidence from the current canonical repo (Nishfleet/0509) and rejects a stale name", async () => {
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
    const listWorkflowRuns = async ({ workflow }: { workflow: string }) =>
      workflow === "uptime-health.yml" ? runs : [];
    const listWorkflowArtifacts = async () => artifacts;
    const collectionTime = new Date(Date.parse(journal.window.endedAt) + GATE_C_SOAK_SETTLE_MS);

    // The repo guard reads process.env.GITHUB_REPOSITORY in CI, which is the
    // canonical owner after the repo moved nish3451/0509 -> Nishfleet/0509.
    // A valid soak from the current repo must be accepted (regression: the
    // guard was pinned to the pre-rename name and rejected every run).
    const prev = process.env.GITHUB_REPOSITORY;
    try {
      process.env.GITHUB_REPOSITORY = "Nishfleet/0509";
      const collected = await collectGitHubSoakEvidence(journal, {
        listWorkflowRuns,
        listWorkflowArtifacts,
        now: collectionTime,
      });
      expect(collected.passed).toBe(true);
      expect(collected.observedWorkerArtifacts).toBe(288);

      // A stale pre-rename name must still fail closed.
      process.env.GITHUB_REPOSITORY = "nish3451/0509";
      await expect(
        collectGitHubSoakEvidence(journal, {
          listWorkflowRuns,
          listWorkflowArtifacts,
          now: collectionTime,
        }),
      ).rejects.toThrow("github_soak_repository_invalid");
    } finally {
      if (prev === undefined) delete process.env.GITHUB_REPOSITORY;
      else process.env.GITHUB_REPOSITORY = prev;
    }
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
        searchRolloutMode: "v2",
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
      searchRolloutMode: "v2",
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
    const artifactRecord = writeGateBArtifact(artifact, `${JSON.stringify({ status: "passed" })}\n`);
    privateJson(resolve(manifest), gateBManifest([artifactRecord]));
    // The separate deploy-readiness file is also a manifest in the set; it
    // declares no additional artifacts here.
    privateJson(resolve(readiness), gateBManifest([]));
    writeFileSync(resolve(wrangler), `${JSON.stringify({ type: "deploy", version: 1, version_id: WORKER_VERSION })}\n`, { mode: 0o600 });
    chmodSync(resolve(wrangler), 0o600);
    privateJson(resolve(rollback), validRollbackTarget());
    privateJson(resolve(gateC), {
      schemaVersion: 1,
      workerVersionId: WORKER_VERSION,
      searchRolloutMode: "v2",
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
      rollbackTargetPath: rollback,
      now: STARTED_AT,
      headCommit: HEAD,
      deploymentWorkflowRunId: DEPLOY_RUN_ID,
      deploymentWorkflowRunAttempt: DEPLOY_RUN_ATTEMPT,
    });
    privateJson(resolve(evidence), journal);

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
    // The deploy-readiness file carries the schemaVersion-3 gate-b manifest and
    // declares the Gate-B artifact for integrity binding.
    const artifactRecord = writeGateBArtifact(artifact, `${JSON.stringify({ status: "passed" })}\n`);
    privateJson(resolve(readiness), gateBManifest([artifactRecord]));
    writeFileSync(resolve(wrangler), `${JSON.stringify({ type: "deploy", version: 1, version_id: WORKER_VERSION })}\n`, { mode: 0o600 });
    chmodSync(resolve(wrangler), 0o600);
    privateJson(resolve(gateC), {
      schemaVersion: 1,
      workerVersionId: WORKER_VERSION,
      searchRolloutMode: "v2",
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
    privateJson(resolve(rollback), validRollbackTarget());
    // Journal binds the gate-b manifest to the deploy-readiness path, exactly as
    // the deploy pipeline does (gate-c-soak start --manifest <deploy-readiness>).
    const journal = buildRunningSoakJournal({
      manifestPath: readiness,
      wranglerOutputPath: wrangler,
      gateCPath: gateC,
      rollbackTargetPath: rollback,
      now: STARTED_AT,
      headCommit: HEAD,
      deploymentWorkflowRunId: DEPLOY_RUN_ID,
      deploymentWorkflowRunAttempt: DEPLOY_RUN_ATTEMPT,
    });
    expect(journal.candidate.gateBManifestPath).toBe(readiness);
    privateJson(resolve(evidence), journal);

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

  it("rejects a tampered Gate-B artifact on both create and restore", () => {
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const readiness = `test-results/deploy-readiness-${suffix}.json`;
    const wrangler = `test-results/wrangler-deploy-output-${suffix}.jsonl`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const evidence = `test-results/production-soak-${suffix}.json`;
    const rollback = `test-results/worker-rollback-target-${suffix}.json`;
    const artifact = `test-results/gate-b-artifacts/${suffix}.json`;
    const createArchive = `test-results/production-release-evidence-${"c".repeat(40)}-127-1.tar.gz`;
    const restoreArchive = `test-results/production-release-evidence-${"c".repeat(40)}-127-2.tar.gz`;
    const evidencePaths = [readiness, wrangler, gateC, evidence, rollback, artifact];
    roots.push(...evidencePaths.map((path) => resolve(path)), resolve(createArchive), resolve(restoreArchive));
    mkdirSync(resolve(dirname(artifact)), { recursive: true });
    const artifactRecord = writeGateBArtifact(artifact, `${JSON.stringify({ status: "passed" })}\n`);
    privateJson(resolve(readiness), gateBManifest([artifactRecord]));
    writeFileSync(resolve(wrangler), `${JSON.stringify({ type: "deploy", version: 1, version_id: WORKER_VERSION })}\n`, { mode: 0o600 });
    chmodSync(resolve(wrangler), 0o600);
    privateJson(resolve(rollback), validRollbackTarget());
    privateJson(resolve(gateC), {
      schemaVersion: 1,
      workerVersionId: WORKER_VERSION,
      searchRolloutMode: "v2",
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
      manifestPath: readiness,
      wranglerOutputPath: wrangler,
      gateCPath: gateC,
      rollbackTargetPath: rollback,
      now: STARTED_AT,
      headCommit: HEAD,
      deploymentWorkflowRunId: DEPLOY_RUN_ID,
      deploymentWorkflowRunAttempt: DEPLOY_RUN_ATTEMPT,
    });
    privateJson(resolve(evidence), journal);

    // Tamper: append one byte to the Gate-B artifact AFTER the manifest recorded
    // its original hash. The manifest stays hash-bound to the journal, so the
    // tamper surfaces only through the new artifact-integrity check.
    appendFileSync(resolve(artifact), "x");

    // Create must reject the tampered artifact (previously it rode along silently).
    expect(() => createReleaseEvidenceArchive({ archivePath: createArchive, evidencePaths }))
      .toThrow("release_evidence_artifact_integrity");

    // Restore must reject it too: hand-tar the tampered set and restore it.
    execFileSync("tar", ["-czf", restoreArchive, "--", ...evidencePaths]);
    chmodSync(resolve(restoreArchive), 0o644);
    for (const path of evidencePaths) rmSync(resolve(path));
    expect(() => restoreReleaseEvidenceArchive({ archivePath: restoreArchive }))
      .toThrow("release_evidence_artifact_integrity");
  });

  it("rejects a rollback-target that is not integrity-bound to the deployed worker version", () => {
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const readiness = `test-results/deploy-readiness-${suffix}.json`;
    const wrangler = `test-results/wrangler-deploy-output-${suffix}.jsonl`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const evidence = `test-results/production-soak-${suffix}.json`;
    const rollback = `test-results/worker-rollback-target-${suffix}.json`;
    const artifact = `test-results/gate-b-artifacts/${suffix}.json`;
    const archive = `test-results/production-release-evidence-${"c".repeat(40)}-128-1.tar.gz`;
    const evidencePaths = [readiness, wrangler, gateC, evidence, rollback, artifact];
    roots.push(...evidencePaths.map((path) => resolve(path)), resolve(archive));
    mkdirSync(resolve(dirname(artifact)), { recursive: true });
    const artifactRecord = writeGateBArtifact(artifact, `${JSON.stringify({ status: "passed" })}\n`);
    privateJson(resolve(readiness), gateBManifest([artifactRecord]));
    writeFileSync(resolve(wrangler), `${JSON.stringify({ type: "deploy", version: 1, version_id: WORKER_VERSION })}\n`, { mode: 0o600 });
    chmodSync(resolve(wrangler), 0o600);
    // Rollback target points at the SAME version that was just deployed — a
    // useless rollback that existence-only checks would have archived anyway.
    // It is still journal-bound (path + sha256), so this reaches the content
    // validation rather than the binding check.
    privateJson(resolve(rollback), { ...validRollbackTarget(), versionId: WORKER_VERSION });
    privateJson(resolve(gateC), {
      schemaVersion: 1,
      workerVersionId: WORKER_VERSION,
      searchRolloutMode: "v2",
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
      manifestPath: readiness,
      wranglerOutputPath: wrangler,
      gateCPath: gateC,
      rollbackTargetPath: rollback,
      now: STARTED_AT,
      headCommit: HEAD,
      deploymentWorkflowRunId: DEPLOY_RUN_ID,
      deploymentWorkflowRunAttempt: DEPLOY_RUN_ATTEMPT,
    });
    privateJson(resolve(evidence), journal);

    expect(() => createReleaseEvidenceArchive({ archivePath: archive, evidencePaths }))
      .toThrow("release_evidence_rollback_target_integrity");
  });

  it("create rejects an archive that omits a manifest-declared artifact (would be unrestorable)", () => {
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const readiness = `test-results/deploy-readiness-${suffix}.json`;
    const wrangler = `test-results/wrangler-deploy-output-${suffix}.jsonl`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const evidence = `test-results/production-soak-${suffix}.json`;
    const rollback = `test-results/worker-rollback-target-${suffix}.json`;
    const artifact1 = `test-results/gate-b-artifacts/${suffix}-1.json`;
    const artifact2 = `test-results/gate-b-artifacts/${suffix}-2.json`;
    const archive = `test-results/production-release-evidence-${"1".repeat(40)}-201-1.tar.gz`;
    roots.push(
      ...[readiness, wrangler, gateC, evidence, rollback, artifact1, artifact2].map((p) => resolve(p)),
      resolve(archive),
    );
    mkdirSync(resolve(dirname(artifact1)), { recursive: true });
    const rec1 = writeGateBArtifact(artifact1, `${JSON.stringify({ a: 1 })}\n`);
    const rec2 = writeGateBArtifact(artifact2, `${JSON.stringify({ a: 2 })}\n`);
    // Manifest declares BOTH artifacts; both exist on disk.
    privateJson(resolve(readiness), gateBManifest([rec1, rec2]));
    writeBoundSoakEvidence({ readiness, wrangler, gateC, rollback, evidence });

    // Archive membership omits artifact2 — on-disk validation would pass, but the
    // archive would be unrestorable. Membership check must catch it at create.
    const evidencePaths = [readiness, wrangler, gateC, evidence, rollback, artifact1];
    expect(() => createReleaseEvidenceArchive({ archivePath: archive, evidencePaths }))
      .toThrow("release_evidence_artifact_membership_mismatch");
  });

  it("rejects an undeclared gate-b-artifacts file riding along in the archive", () => {
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const readiness = `test-results/deploy-readiness-${suffix}.json`;
    const wrangler = `test-results/wrangler-deploy-output-${suffix}.jsonl`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const evidence = `test-results/production-soak-${suffix}.json`;
    const rollback = `test-results/worker-rollback-target-${suffix}.json`;
    const artifact1 = `test-results/gate-b-artifacts/${suffix}-1.json`;
    const undeclared = `test-results/gate-b-artifacts/${suffix}-stowaway.json`;
    const archive = `test-results/production-release-evidence-${"2".repeat(40)}-202-1.tar.gz`;
    roots.push(
      ...[readiness, wrangler, gateC, evidence, rollback, artifact1, undeclared].map((p) => resolve(p)),
      resolve(archive),
    );
    mkdirSync(resolve(dirname(artifact1)), { recursive: true });
    const rec1 = writeGateBArtifact(artifact1, `${JSON.stringify({ a: 1 })}\n`);
    writeGateBArtifact(undeclared, `${JSON.stringify({ stowaway: true })}\n`);
    // Manifest declares only artifact1, but an undeclared file is in the archive.
    privateJson(resolve(readiness), gateBManifest([rec1]));
    writeBoundSoakEvidence({ readiness, wrangler, gateC, rollback, evidence });

    const evidencePaths = [readiness, wrangler, gateC, evidence, rollback, artifact1, undeclared];
    expect(() => createReleaseEvidenceArchive({ archivePath: archive, evidencePaths }))
      .toThrow("release_evidence_artifact_membership_mismatch");
  });

  it("validates EVERY archived manifest — a tampered auxiliary cross-browser artifact is caught", () => {
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const readiness = `test-results/deploy-readiness-${suffix}.json`;
    // A cross-browser diagnostic manifest (deploy-readiness-<project>) also
    // matches the manifest pattern and declares its own artifact subtree.
    const auxManifest = `test-results/deploy-readiness-local-release-firefox-${suffix}.json`;
    const wrangler = `test-results/wrangler-deploy-output-${suffix}.jsonl`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const evidence = `test-results/production-soak-${suffix}.json`;
    const rollback = `test-results/worker-rollback-target-${suffix}.json`;
    const artifact1 = `test-results/gate-b-artifacts/${suffix}-authoritative.json`;
    const artifact2 = `test-results/gate-b-artifacts/${suffix}-firefox.json`;
    const archive = `test-results/production-release-evidence-${"3".repeat(40)}-203-1.tar.gz`;
    const evidencePaths = [readiness, auxManifest, wrangler, gateC, evidence, rollback, artifact1, artifact2];
    roots.push(...evidencePaths.map((p) => resolve(p)), resolve(archive));
    mkdirSync(resolve(dirname(artifact1)), { recursive: true });
    const rec1 = writeGateBArtifact(artifact1, `${JSON.stringify({ a: 1 })}\n`);
    const rec2 = writeGateBArtifact(artifact2, `${JSON.stringify({ a: 2 })}\n`);
    privateJson(resolve(readiness), gateBManifest([rec1]));
    privateJson(resolve(auxManifest), gateBManifest([rec2]));
    writeBoundSoakEvidence({ readiness, wrangler, gateC, rollback, evidence });

    // Tamper the auxiliary manifest's artifact — only caught if aux manifests
    // are validated too, not just the journal-bound authoritative one.
    appendFileSync(resolve(artifact2), "x");
    expect(() => createReleaseEvidenceArchive({ archivePath: archive, evidencePaths }))
      .toThrow("release_evidence_artifact_integrity");
  });

  it("rejects a duplicate worker-rollback-target file", () => {
    mkdirSync(resolve("test-results"), { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const readiness = `test-results/deploy-readiness-${suffix}.json`;
    const wrangler = `test-results/wrangler-deploy-output-${suffix}.jsonl`;
    const gateC = `test-results/gate-c-${suffix}.json`;
    const evidence = `test-results/production-soak-${suffix}.json`;
    const rollback = `test-results/worker-rollback-target-${suffix}.json`;
    const rollbackDuplicate = `test-results/worker-rollback-target-${suffix}-extra.json`;
    const artifact = `test-results/gate-b-artifacts/${suffix}.json`;
    const archive = `test-results/production-release-evidence-${"4".repeat(40)}-204-1.tar.gz`;
    const evidencePaths = [readiness, wrangler, gateC, evidence, rollback, rollbackDuplicate, artifact];
    roots.push(...evidencePaths.map((p) => resolve(p)), resolve(archive));
    mkdirSync(resolve(dirname(artifact)), { recursive: true });
    const rec = writeGateBArtifact(artifact, `${JSON.stringify({ status: "passed" })}\n`);
    privateJson(resolve(readiness), gateBManifest([rec]));
    writeBoundSoakEvidence({ readiness, wrangler, gateC, rollback, evidence });
    // A second, unbound rollback file that the journal does not reference.
    privateJson(resolve(rollbackDuplicate), validRollbackTarget());

    expect(() => createReleaseEvidenceArchive({ archivePath: archive, evidencePaths }))
      .toThrow("release_evidence_rollback_target_binding_invalid");
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
