#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { checkHealthEndpoint, DEFAULT_CANARY_HEALTH_BASE_URLS } from "./prod-canary.lib.mjs";
import {
  buildRunningSoakJournal,
  collectGitHubSoakEvidence,
  readSafePrivateJson,
  resolveSafeEvidencePath,
  sha256File,
  validateReleaseSoakPayload,
  validateFinalGateCForSoak,
  validateRunningSoakJournal,
  validateStartedSoakJournal,
} from "./gate-c-soak.lib.mjs";

/** @param {string} name */
function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

/** @param {string} path @param {unknown} value @param {boolean} [exclusive] */
function atomicWrite(path, value, exclusive = false) {
  mkdirSync(dirname(path), { recursive: true });
  if (exclusive) {
    const descriptor = openSync(path, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    return;
  }
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** @param {string} workerVersionId */
async function verifyLiveIdentity(workerVersionId) {
  const checks = await Promise.all(DEFAULT_CANARY_HEALTH_BASE_URLS.map((baseUrl) =>
    checkHealthEndpoint({
      baseUrl,
      expectedWorkerVersionId: workerVersionId,
      expectedSearchRolloutMode: "v2",
    }),
  ));
  if (!checks.every((check) => check.ok)) throw new Error("soak_live_identity_mismatch");
}

/** @param {string} workerVersionId */
function resolveGateCPath(workerVersionId) {
  const safeVersion = workerVersionId.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return `test-results/gate-c-${safeVersion}.json`;
}

async function start() {
  const manifestPath = readArg("--manifest");
  const wranglerOutputPath = readArg("--wrangler-output");
  const rollbackTargetPath = readArg("--rollback-target");
  const headCommit = readArg("--head") ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!manifestPath || !wranglerOutputPath || !rollbackTargetPath) throw new Error("soak_start_inputs_missing");
  const deploymentWorkflowRunId = Number(readArg("--deployment-run-id") ?? process.env.GITHUB_RUN_ID);
  const deploymentWorkflowRunAttempt = Number(readArg("--deployment-run-attempt") ?? process.env.GITHUB_RUN_ATTEMPT);
  const provisional = buildRunningSoakJournal({
    manifestPath,
    wranglerOutputPath,
    rollbackTargetPath,
    gateCPath: readArg("--gate-c") ?? resolveGateCPath(
      (await import("./deploy-production-plan.mjs")).readDeployedWorkerVersionId(
        readFileSync(resolveSafeEvidencePath(wranglerOutputPath), "utf8"),
      ),
    ),
    headCommit,
    deploymentWorkflowRunId,
    deploymentWorkflowRunAttempt,
  });
  await verifyLiveIdentity(provisional.deployment.workerVersionId);
  const outputPath = readArg("--output") ?? `test-results/production-soak-${provisional.deployment.workerVersionId}.json`;
  const resolvedOutput = resolveSafeEvidencePath(outputPath);
  atomicWrite(resolvedOutput, provisional, true);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: "running",
    workerVersionId: provisional.deployment.workerVersionId,
    outputPath,
    endedAt: provisional.window.endedAt,
  })}\n`);
}

async function finalize() {
  const journalPath = readArg("--journal");
  if (!journalPath) throw new Error("soak_journal_path_missing");
  const journal = validateRunningSoakJournal(readSafePrivateJson(journalPath));
  const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (currentHead !== journal.candidate.headCommit) throw new Error("soak_candidate_head_drift");
  await verifyLiveIdentity(journal.deployment.workerVersionId);
  const initialGitHubSoak = await collectGitHubSoakEvidence(journal);
  if (!initialGitHubSoak.passed) throw new Error("github_uptime_soak_failed");
  const token = process.env.CANARY_BYPASS_TOKEN?.trim();
  if (!token) throw new Error("canary_bypass_token_missing");
  const response = await fetch("https://0509.io/api/release-soak", {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "x-0509-canary-token": token,
      "x-0509-expected-worker-version": journal.deployment.workerVersionId,
    },
    body: JSON.stringify({
      startedAt: journal.window.startedAt,
      endedAt: journal.window.endedAt,
    }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("soak_probe_invalid_json");
  }
  if (!response.ok) throw new Error("soak_probe_failed");
  const validatedPayload = validateReleaseSoakPayload(payload, journal);

  const windowKey = journal.window.endedAt.replace(/[-:.]/gu, "").replace("T", "t").replace("Z", "z");
  const finalGateCPath = `test-results/gate-c-${journal.deployment.workerVersionId}-soak-final-${windowKey}.json`;
  const finalGateRunId = `gate-c-${journal.deployment.workerVersionId}-soak-final-${windowKey}`;
  const { runVersionBoundGateC } = await import("./verify-post-deploy-release.mjs");
  const gateC = await runVersionBoundGateC({
    workerVersionId: journal.deployment.workerVersionId,
    token,
    evidencePath: resolve(finalGateCPath),
    gateRunIdOverride: finalGateRunId,
  });
  if (!gateC.passed) throw new Error("soak_final_gate_c_failed");

  validateFinalGateCForSoak(journal, gateC.journal, finalGateRunId, new Date());
  const githubSoak = await collectGitHubSoakEvidence(journal);
  if (!githubSoak.passed) throw new Error("github_uptime_soak_failed");
  const completedAt = new Date().toISOString();
  const finalGateCSha256 = sha256File(resolveSafeEvidencePath(finalGateCPath));
  const final = {
    ...journal,
    status: "passed",
    updatedAt: completedAt,
    completedAt,
    final: {
      evidenceClass: validatedPayload.evidenceClass,
      expectedObservations: validatedPayload.expectedObservations,
      observedObservations: validatedPayload.observedObservations,
      maxTaskDurationMs: validatedPayload.maxTaskDurationMs,
      blockers: [],
      releaseSoak: validatedPayload,
      releaseSoakSha256: createHash("sha256").update(JSON.stringify(validatedPayload)).digest("hex"),
      githubUptime: githubSoak,
      finalGateCPath,
      finalGateCSha256,
      finalGateCGeneratedAt: gateC.journal.generatedAt,
      finalGateCCompletedAt: gateC.journal.completedAt,
    },
  };
  atomicWrite(resolveSafeEvidencePath(journalPath), final);
  process.stdout.write(`${JSON.stringify({ ok: true, status: "passed", workerVersionId: journal.deployment.workerVersionId })}\n`);
}

function verifyStart() {
  const journalPath = readArg("--journal");
  if (!journalPath) throw new Error("soak_journal_path_missing");
  const journal = validateStartedSoakJournal(readSafePrivateJson(journalPath));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: journal.status,
    workerVersionId: journal.deployment.workerVersionId,
    endedAt: journal.window.endedAt,
  })}\n`);
}

async function main() {
  const command = process.argv[2];
  if (command === "start") return start();
  if (command === "verify-start") return verifyStart();
  if (command === "finalize") return finalize();
  throw new Error("gate_c_soak_command_required");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "gate_c_soak_failed"}\n`);
    process.exitCode = 1;
  });
}
