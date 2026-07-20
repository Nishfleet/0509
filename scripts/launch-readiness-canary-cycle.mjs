#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import { DEFAULT_BASE_URL, runCanary } from "./launch-readiness-canary.mjs";

/** @param {unknown} value */
function isIdentifier(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value
  );
}

/** @param {string} baseUrl */
function startConfig(baseUrl) {
  return {
    baseUrl,
    json: true,
    cleanup: false,
    runId: null,
    digestRunId: null,
    proofCaptureId: null,
    proofProvider: null,
    requireSlack: false,
    requireWhatsApp: false,
    expectedWorkerVersionId: null,
    gateRunId: null,
  };
}

const GATE_RUN_ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;

export async function runLaunchReadinessCanaryCycle({
  baseUrl = process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
  runCanaryImpl = runCanary,
  expectedWorkerVersionId = null,
  gateRunId = null,
} = {}) {
  if (!isIdentifier(expectedWorkerVersionId)) {
    throw new Error("launch_readiness_proof_canary_unbound");
  }
  if (typeof gateRunId !== "string" || !GATE_RUN_ID_PATTERN.test(gateRunId)) {
    throw new Error("launch_readiness_proof_canary_gate_run_missing");
  }
  // gateRunId binds only the start canary; cleanup must send the three
  // cleanup IDs without it (the canary client rejects both together).
  const started = await runCanaryImpl({
    config: { ...startConfig(baseUrl), expectedWorkerVersionId, gateRunId },
  });
  const startPayload = started?.payload;
  if (!started?.response?.ok || startPayload?.ok !== true) {
    throw new Error("launch_readiness_proof_canary_failed");
  }

  const { runId, digestRunId, proofCaptureId } = startPayload;
  if (![runId, digestRunId, proofCaptureId].every(isIdentifier)) {
    throw new Error("launch_readiness_proof_canary_missing_cleanup_ids");
  }

  const cleaned = await runCanaryImpl({
    config: {
      ...startConfig(baseUrl),
      cleanup: true,
      expectedWorkerVersionId,
      runId,
      digestRunId,
      proofCaptureId,
    },
  });
  if (!cleaned?.response?.ok || cleaned?.payload?.ok !== true) {
    throw new Error("launch_readiness_proof_canary_cleanup_failed");
  }
  if (cleaned.payload?.cleanup?.preservedProofCaptureId !== proofCaptureId) {
    throw new Error("launch_readiness_proof_capture_not_preserved");
  }

  return {
    ok: true,
    proofCaptureId,
    cleanup: cleaned.payload.cleanup,
  };
}

/**
 * @param {string[]} argv
 * @param {string} name
 */
function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (typeof value !== "string" || !value.trim() || value.startsWith("--")) {
    // A flag without a value must fail loudly rather than silently falling
    // back to a stale environment variable.
    throw new Error(`launch_readiness_proof_canary_missing_value:${name}`);
  }
  return value;
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveExpectedWorkerVersionId(argv, env) {
  const wranglerOutputPath = readArg(argv, "--wrangler-output");
  if (wranglerOutputPath) {
    return readDeployedWorkerVersionId(
      readFileSync(resolve(wranglerOutputPath), "utf8"),
    );
  }
  return env.CANARY_EXPECTED_WORKER_VERSION_ID?.trim() || null;
}

/**
 * The proof canary's resume identity. Defaults to the exact deployed Worker
 * version so the proof is bound to the publish it validates; an explicit
 * --gate-run-id / CANARY_GATE_RUN_ID overrides for manual runs.
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {string | null} expectedWorkerVersionId
 */
export function resolveGateRunId(argv, env, expectedWorkerVersionId) {
  return (
    readArg(argv, "--gate-run-id") ??
    (env.CANARY_GATE_RUN_ID?.trim() ||
      (expectedWorkerVersionId
        ? `deploy-${expectedWorkerVersionId.toLowerCase()}`
        : null))
  );
}

async function main() {
  try {
    const argv = process.argv.slice(2);
    const expectedWorkerVersionId = resolveExpectedWorkerVersionId(
      argv,
      process.env,
    );
    const result = await runLaunchReadinessCanaryCycle({
      expectedWorkerVersionId,
      gateRunId: resolveGateRunId(argv, process.env, expectedWorkerVersionId),
    });
    console.log(
      `launch readiness proof canary cycle: ok (${result.proofCaptureId})`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
