#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://0509.in";

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  /** @type {{ baseUrl: string, json: boolean, email: string | null }} */
  const parsed = {
    baseUrl: process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
    json: false,
    email: process.env.CANARY_BILLING_EMAIL || null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url" && args[index + 1]) {
      parsed.baseUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--email" && args[index + 1]) {
      parsed.email = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
    }
  }

  return parsed;
}

/**
 * @param {unknown} payload
 */
function formatReport(payload) {
  if (!payload || typeof payload !== "object") {
    return "Dodo billing canary: failed (invalid response)";
  }

  const body = /** @type {{ ok?: boolean, blocker?: string, user?: { email?: string, plan?: string }, webhook?: { plan?: { status?: number }, proofCredits?: { status?: number } }, grants?: { paidPlanUnlocked?: boolean, planCleanupOk?: boolean, paidPlanCleanupOk?: boolean, watchlistCleanupOk?: boolean, proofCreditsGranted?: boolean, proofCreditCleanupOk?: boolean, credits?: number } }} */ (payload);
  const lines = [`Dodo billing canary: ${body.ok ? "ok" : "failed"}`];

  if (body.blocker) {
    lines.push(`blocker: ${body.blocker}`);
  }
  if (body.user?.email) {
    lines.push(`user: ${body.user.email} (${body.user.plan ?? "unknown"})`);
  }
  if (body.webhook) {
    lines.push(
      `webhooks: plan ${body.webhook.plan?.status ?? "unknown"}, proof credits ${
        body.webhook.proofCredits?.status ?? "unknown"
      }`,
    );
  }
  if (body.grants) {
    const planCleanupOk = body.grants.planCleanupOk ?? body.grants.paidPlanCleanupOk;
    const watchlistCleanupOk = body.grants.watchlistCleanupOk ?? planCleanupOk;
    lines.push(
      `grants: plan ${body.grants.paidPlanUnlocked ? "unlocked" : "not unlocked"}, plan cleanup ${
        planCleanupOk ? "ok" : "failed"
      }, watchlist cleanup ${
        watchlistCleanupOk ? "ok" : "failed"
      }, proof credits ${body.grants.proofCreditsGranted ? "granted" : "not granted"}, credit cleanup ${
        body.grants.proofCreditCleanupOk ? "ok" : "failed"
      }`,
    );
  }

  return lines.join("\n");
}

const config = parseArgs(process.argv.slice(2));
const token = process.env.CANARY_BYPASS_TOKEN?.trim();

if (!token) {
  console.error("Missing CANARY_BYPASS_TOKEN; source .dev.vars or set the secret before running this canary.");
  process.exit(1);
}

const url = new URL("/api/billing/dodo/canary", config.baseUrl);
const headers = {
  "user-agent": "0509-dodo-billing-canary/1.0",
  "x-0509-canary-token": token,
};
const body = config.email ? JSON.stringify({ email: config.email }) : undefined;
if (body) {
  headers["content-type"] = "application/json";
}

const response = await fetch(url, {
  method: "POST",
  headers,
  body,
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
