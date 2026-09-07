#!/usr/bin/env node
// d1-budget: reads=500 writes=50 runs_per_day=10

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import { DEFAULT_BASE_URL, runCanary } from "./launch-readiness-canary.mjs";
import { waitForExpectedWorkerVersion } from "./prod-canary.lib.mjs";

// The propagation waiter now lives in prod-canary.lib.mjs so the post-deploy
// Gate C verifier can share it without importing this module (that would form a
// cycle: verifier -> cycle -> deploy-production-plan -> verifier). Re-exported
// here to keep the historical import path stable for existing callers/tests.
export { waitForExpectedWorkerVersion };

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

/**
 * @param {{
 *   baseUrl?: string,
 *   runCanaryImpl?: (input: { config: any }) => Promise<{ payload: any, response: Response }>,
 *   expectedWorkerVersionId?: string | null,
 *   gateRunId?: string | null,
 * }} [input]
 */
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
  if (startPayload?.workerVersionId !== expectedWorkerVersionId) {
    throw new Error("launch_readiness_proof_canary_worker_version_mismatch");
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
    const status = Number.isInteger(cleaned?.response?.status) ? cleaned.response.status : "unknown";
    const blocker = isIdentifier(cleaned?.payload?.blocker) ? cleaned.payload.blocker : "unknown";
    throw new Error(`launch_readiness_proof_canary_cleanup_failed:status=${status}:blocker=${blocker}`);
  }
  if (cleaned.payload?.workerVersionId !== expectedWorkerVersionId) {
    throw new Error("launch_readiness_cleanup_worker_version_mismatch");
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
 * @param {Record<string, string | undefined>} env
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
 * @param {Record<string, string | undefined>} env
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

/**
 * CLI orchestration for the propagation waiter and (optionally) the proof
 * cycle. Dependency-injectable so `--wait-only` can be proven to run the
 * waiter and NEVER invoke a mutating canary.
 *
 * With `--wait-only` the script resolves + waits for the exact deployed Worker
 * version (same fail-closed missing-value behavior, same all-alias exact-worker
 * wall-clock waiter) and exits 0 without running any canary mutation. Without
 * the flag it behaves exactly as before: the full cycle preceded by the waiter.
 * @param {{
 *   argv: string[],
 *   env: Record<string, string | undefined>,
 *   waitForExpectedWorkerVersionImpl?: typeof waitForExpectedWorkerVersion,
 *   runCycleImpl?: typeof runLaunchReadinessCanaryCycle,
 * }} input
 */
export async function runCanaryCycleCli({
  argv,
  env,
  waitForExpectedWorkerVersionImpl = waitForExpectedWorkerVersion,
  runCycleImpl = runLaunchReadinessCanaryCycle,
}) {
  const waitOnly = argv.includes("--wait-only");
  const expectedWorkerVersionId = resolveExpectedWorkerVersionId(argv, env);
  if (
    typeof expectedWorkerVersionId !== "string" ||
    !isIdentifier(expectedWorkerVersionId)
  ) {
    throw new Error("launch_readiness_proof_canary_unbound");
  }
  await waitForExpectedWorkerVersionImpl({ expectedWorkerVersionId });
  if (waitOnly) {
    return {
      mode: /** @type {const} */ ("wait-only"),
      expectedWorkerVersionId,
    };
  }
  const result = await runCycleImpl({
    expectedWorkerVersionId,
    gateRunId: resolveGateRunId(argv, env, expectedWorkerVersionId),
  });
  return {
    mode: /** @type {const} */ ("cycle"),
    proofCaptureId: result.proofCaptureId,
  };
}

async function main() {
  try {
    const outcome = await runCanaryCycleCli({
      argv: process.argv.slice(2),
      env: process.env,
    });
    if (outcome.mode === "wait-only") {
      console.log(
        `launch readiness worker propagation: stable (${outcome.expectedWorkerVersionId})`,
      );
    } else {
      console.log(
        `launch readiness proof canary cycle: ok (${outcome.proofCaptureId})`,
      );
    }
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
