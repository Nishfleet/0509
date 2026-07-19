#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  fetchCanary,
  validateCanonicalBaseUrl,
} from "./dodo-billing-canary.mjs";

export const DEFAULT_BASE_URL = "https://0509.io";
export const SUPPORTED_PROOF_PROVIDERS = Object.freeze(["browserless"]);

/** @param {string | null | undefined} value */
function normalizeProofProvider(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (SUPPORTED_PROOF_PROVIDERS.includes(value)) {
    return value;
  }
  throw new Error(`Unsupported launch proof provider: ${value}.`);
}

/**
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ baseUrl: string, json: boolean, cleanup: boolean, runId: string | null, digestRunId: string | null, proofCaptureId: string | null, proofProvider: string | null, requireSlack: boolean, requireWhatsApp: boolean, expectedWorkerVersionId: string | null, gateRunId: string | null }} */
  const parsed = {
    baseUrl: process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
    json: false,
    cleanup: false,
    runId: null,
    digestRunId: null,
    proofCaptureId: null,
    proofProvider: null,
    requireSlack: false,
    requireWhatsApp: false,
    expectedWorkerVersionId: process.env.CANARY_EXPECTED_WORKER_VERSION_ID || null,
    gateRunId: process.env.CANARY_GATE_RUN_ID || null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url" && args[index + 1]) {
      parsed.baseUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-worker-version" && args[index + 1]) {
      parsed.expectedWorkerVersionId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--gate-run-id" && args[index + 1]) {
      parsed.gateRunId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--proof-provider" && args[index + 1]) {
      parsed.proofProvider = normalizeProofProvider(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--proof-provider") {
      throw new Error("Missing value for --proof-provider.");
    }
    if (arg === "--require-slack") {
      parsed.requireSlack = true;
      continue;
    }
    if (arg === "--require-whatsapp") {
      parsed.requireWhatsApp = true;
      continue;
    }
    if (arg === "--cleanup") {
      parsed.cleanup = true;
      continue;
    }
    if (arg === "--run-id" && args[index + 1]) {
      parsed.runId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--digest-run-id" && args[index + 1]) {
      parsed.digestRunId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--proof-capture-id" && args[index + 1]) {
      parsed.proofCaptureId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
    }
  }

  return parsed;
}

/** @param {unknown} value */
function isCleanupIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value && !(/[\u0000-\u001f\u007f\s]/u.test(value));
}

/**
 * @param {{ baseUrl: string, proofProvider: string | null, requireSlack: boolean, requireWhatsApp: boolean }} config
 */
export function buildCanaryUrl(config) {
  const url = new URL("/api/launch-readiness/canary", validateCanonicalBaseUrl(config.baseUrl));
  const proofProvider = normalizeProofProvider(config.proofProvider);
  if (proofProvider) {
    url.searchParams.set("proofProvider", proofProvider);
  }
  if (config.requireSlack) {
    url.searchParams.set("requireSlack", "true");
  }
  if (config.requireWhatsApp) {
    url.searchParams.set("requireWhatsApp", "true");
  }
  return url;
}

/**
 * @param {unknown} payload
 */
function formatReport(payload) {
  if (!payload || typeof payload !== "object") {
    return "launch readiness proof canary: failed (invalid response)";
  }

  const body = /** @type {{ ok?: boolean, blockers?: string[], runId?: string, digestRunId?: string, proofCaptureId?: string, delivery?: { attempts?: number, channels?: string[], details?: Array<{ channel?: string, status?: string, errorMessage?: string | null }> }, slackDelivery?: { required?: boolean, sent?: boolean }, whatsappDelivery?: { required?: boolean, sent?: boolean, lane?: string } }} */ (payload);
  const lines = [
    `launch readiness proof canary: ${body.ok ? "ok" : "failed"}`,
  ];

  if (Array.isArray(body.blockers) && body.blockers.length > 0) {
    lines.push(`blockers: ${body.blockers.join(", ")}`);
  }
  if (body.runId) {
    lines.push(`run: ${body.runId}`);
  }
  if (body.digestRunId) {
    lines.push(`digest: ${body.digestRunId}`);
  }
  if (body.proofCaptureId) {
    lines.push(`proof: ${body.proofCaptureId}`);
  }
  if (body.delivery) {
    const channels = Array.isArray(body.delivery.channels) ? body.delivery.channels.join(", ") : "none";
    lines.push(`delivery attempts: ${body.delivery.attempts ?? 0} (${channels})`);
  }
  if (body.slackDelivery?.required) {
    lines.push(`slack required: ${body.slackDelivery.sent ? "sent" : "not sent"}`);
  }
  if (body.whatsappDelivery?.required) {
    lines.push(
      `whatsapp required: ${body.whatsappDelivery.sent ? "sent" : "not sent"} (${body.whatsappDelivery.lane ?? "unknown"} lane)`,
    );
    lines.push("whatsapp delivered proof is completed only after Meta webhook reconciliation marks the message delivered.");
  }

  return lines.join("\n");
}

/**
 * @param {unknown} payload
 */
function formatCleanupReport(payload) {
  if (!payload || typeof payload !== "object") {
    return "launch readiness canary cleanup: failed (invalid response)";
  }

  const body = /** @type {{ ok?: boolean, blocker?: string, cleanupTruth?: string, cleanup?: { preservedProofCaptureId?: string | null, deleted?: Record<string, number> } }} */ (payload);
  const lines = [`launch readiness canary cleanup: ${body.ok ? "ok" : "failed"}`];
  if (body.blocker) {
    lines.push(`blocker: ${body.blocker}`);
  }
  if (body.cleanup?.preservedProofCaptureId) {
    lines.push(`preserved proof capture: ${body.cleanup.preservedProofCaptureId}`);
  }
  if (body.cleanup?.deleted) {
    const deleted = body.cleanup.deleted;
    lines.push(
      `deleted verified rows: ${deleted.watchlistRuns ?? 0} watch, ${deleted.digestItems ?? 0} digest items, ${deleted.digestDeliveries ?? 0} digest deliveries, ${deleted.deliveryAttempts ?? 0} delivery attempts, ${deleted.watchEvents ?? 0} events, ${deleted.digestRuns ?? 0} digests`,
    );
  }
  if (body.cleanupTruth) {
    lines.push(body.cleanupTruth);
  }
  return lines.join("\n");
}

/**
 * @param {{ config?: ReturnType<typeof parseArgs>, token?: string, fetchImpl?: typeof fetch }} [input]
 */
export async function runCanary({ config = parseArgs([]), token = process.env.CANARY_BYPASS_TOKEN?.trim(), fetchImpl = fetch } = {}) {
  if (config.cleanup) {
    const hasTicket = [config.runId, config.digestRunId, config.proofCaptureId].every(isCleanupIdentifier);
    const hasGateRunId = typeof config.gateRunId === "string" && isCleanupIdentifier(config.gateRunId) && /^[a-z0-9._-]{1,128}$/u.test(config.gateRunId);
    if (hasTicket === hasGateRunId) {
      throw new Error("Cleanup requires either the three cleanup IDs or one bounded --gate-run-id, but not both.");
    }
    if (config.proofProvider || config.requireSlack || config.requireWhatsApp) {
      throw new Error("Cleanup cannot be combined with provider or delivery proof flags.");
    }
  } else if ([config.runId, config.digestRunId, config.proofCaptureId].some((value) => value !== null)) {
    throw new Error("Cleanup IDs require the explicit --cleanup flag.");
  }

  if (!token) {
    throw new Error("Missing CANARY_BYPASS_TOKEN; source .dev.vars or set the secret before running this canary.");
  }
  if (!config.cleanup && !config.expectedWorkerVersionId) {
    throw new Error("Missing expected Worker version ID; refusing an unbound proof canary.");
  }
  if (!config.cleanup && (!config.gateRunId || !/^[a-z0-9._-]{1,128}$/u.test(config.gateRunId))) {
    throw new Error("Missing or invalid gate run ID; refusing a non-resumable proof canary.");
  }

  // buildCanaryUrl validates the exact canonical origin before fetchCanary can construct token headers.
  const url = buildCanaryUrl(config);
  const response = await fetchCanary({
    url,
    token,
    userAgent: "0509-launch-readiness-proof-canary/1.0",
    extraHeaders: {
      ...(config.expectedWorkerVersionId
        ? { "x-0509-expected-worker-version": config.expectedWorkerVersionId }
        : {}),
      ...(config.cleanup ? { "x-0509-canary-operation": "cleanup" } : {}),
    },
    body: config.cleanup
      ? JSON.stringify(
          config.gateRunId
            ? { gateRunId: config.gateRunId }
            : {
                runId: config.runId,
                digestRunId: config.digestRunId,
                proofCaptureId: config.proofCaptureId,
              },
        )
      : JSON.stringify({ gateRunId: config.gateRunId }),
    fetchImpl,
  });
  const payload = await response.json().catch(() => null);

  return { payload, response };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  try {
    const { payload, response } = await runCanary({ config });
    if (config.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(config.cleanup ? formatCleanupReport(payload) : formatReport(payload));
    }
    if (!response.ok || !payload?.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
