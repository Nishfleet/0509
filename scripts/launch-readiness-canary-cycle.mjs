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

export async function runLaunchReadinessCanaryCycle({
  baseUrl = process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
  runCanaryImpl = runCanary,
  expectedWorkerVersionId = null,
} = {}) {
  if (!isIdentifier(expectedWorkerVersionId)) {
    throw new Error("launch_readiness_proof_canary_unbound");
  }
  const started = await runCanaryImpl({
    config: { ...startConfig(baseUrl), expectedWorkerVersionId },
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

/** @param {string} name */
function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function resolveExpectedWorkerVersionId() {
  const wranglerOutputPath = readArg("--wrangler-output");
  if (wranglerOutputPath) {
    return readDeployedWorkerVersionId(
      readFileSync(resolve(wranglerOutputPath), "utf8"),
    );
  }
  return process.env.CANARY_EXPECTED_WORKER_VERSION_ID?.trim() || null;
}

async function main() {
  try {
    const result = await runLaunchReadinessCanaryCycle({
      expectedWorkerVersionId: resolveExpectedWorkerVersionId(),
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
