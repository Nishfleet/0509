#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  DEFAULT_BASE_URL,
  runCanary,
} from "./launch-readiness-canary.mjs";

/** @param {unknown} value */
function isIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
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
  };
}

export async function runLaunchReadinessCanaryCycle({
  baseUrl = process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
  runCanaryImpl = runCanary,
} = {}) {
  const started = await runCanaryImpl({ config: startConfig(baseUrl) });
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

async function main() {
  try {
    const result = await runLaunchReadinessCanaryCycle();
    console.log(`launch readiness proof canary cycle: ok (${result.proofCaptureId})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
