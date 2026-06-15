#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://0509.io";

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  /** @type {{ baseUrl: string, json: boolean, proofProvider: string | null, requireSlack: boolean, requireWhatsApp: boolean }} */
  const parsed = {
    baseUrl: process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
    json: false,
    proofProvider: null,
    requireSlack: false,
    requireWhatsApp: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url" && args[index + 1]) {
      parsed.baseUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--proof-provider" && args[index + 1]) {
      parsed.proofProvider = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--require-slack") {
      parsed.requireSlack = true;
      continue;
    }
    if (arg === "--require-whatsapp") {
      parsed.requireWhatsApp = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
    }
  }

  return parsed;
}

/**
 * @param {{ baseUrl: string, proofProvider: string | null, requireSlack: boolean, requireWhatsApp: boolean }} config
 */
function buildCanaryUrl(config) {
  const url = new URL("/api/launch-readiness/canary", config.baseUrl);
  if (config.proofProvider) {
    url.searchParams.set("proofProvider", config.proofProvider);
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

const config = parseArgs(process.argv.slice(2));
const token = process.env.CANARY_BYPASS_TOKEN?.trim();

if (!token) {
  console.error("Missing CANARY_BYPASS_TOKEN; source .dev.vars or set the secret before running this canary.");
  process.exit(1);
}

const url = buildCanaryUrl(config);
const response = await fetch(url, {
  method: "POST",
  headers: {
    "user-agent": "0509-launch-readiness-proof-canary/1.0",
    "x-0509-canary-token": token,
  },
  signal: AbortSignal.timeout(60_000),
});
const payload = await response.json().catch(() => null);

if (config.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(formatReport(payload));
}

if (!response.ok || !payload?.ok) {
  process.exitCode = 1;
}
