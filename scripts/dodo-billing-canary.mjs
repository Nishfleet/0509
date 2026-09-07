#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const DEFAULT_BASE_URL = "https://0509.io";
const CANONICAL_ORIGIN = "https://0509.io";
const MAX_REDIRECTS = 5;

/**
 * @param {unknown} value
 * @returns {URL}
 */
export function validateCanonicalBaseUrl(value) {
  if (typeof value !== "string" || !/^https:\/\/0509\.io\/?$/u.test(value)) {
    throw new Error("Canary base URL must be exactly https://0509.io.");
  }

  return new URL(value);
}

/**
 * @param {string | URL} value
 * @returns {URL}
 */
function validateCanonicalRequestUrl(value) {
  // URL normalizes default ports away (for example, `https://0509.io:443`),
  // so reject explicit authority credentials/ports from the original string
  // before parsing it. Redirect locations are checked by validateRedirect too.
  if (typeof value === "string") {
    rejectExplicitAuthorityCredentialsOrPort(value);
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== CANONICAL_ORIGIN ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("Canary request URL must remain on the exact https://0509.io origin.");
  }
  return url;
}

/**
 * @param {string} location
 */
function rejectExplicitAuthorityCredentialsOrPort(location) {
  if (/^(?:https?:)?\/\/[^/?#]*[@:]/iu.test(location)) {
    throw new Error("Canary redirect must not contain credentials or an explicit port.");
  }
}

/**
 * @param {string | null} location
 * @param {URL} currentUrl
 * @returns {URL}
 */
function validateRedirect(location, currentUrl) {
  if (!location) {
    throw new Error("Canary redirect is missing a Location header.");
  }
  rejectExplicitAuthorityCredentialsOrPort(location);
  return validateCanonicalRequestUrl(new URL(location, currentUrl));
}

/**
 * Fetch a canary endpoint without ever sending the bypass token to an
 * unapproved origin, including a redirect target.
 *
 * @param {{ url: string | URL, token: string, body?: string, userAgent?: string, extraHeaders?: Record<string, string>, fetchImpl?: typeof fetch }} input
 */
export async function fetchCanary({ url, token, body, userAgent = "0509-dodo-billing-canary/1.0", extraHeaders = {}, fetchImpl = fetch }) {
  if (!token?.trim()) {
    throw new Error("Missing CANARY_BYPASS_TOKEN; refusing to construct credential-bearing headers.");
  }

  let currentUrl = validateCanonicalRequestUrl(url);
  let method = "POST";
  let currentBody = body;

  for (let redirectCount = 0; ; redirectCount += 1) {
    if (redirectCount > MAX_REDIRECTS) {
      throw new Error("Canary redirect chain exceeded the maximum allowed redirects.");
    }

    // Validate the URL before constructing the credential-bearing headers.
    const headers = new Headers({
      "user-agent": userAgent,
      "x-0509-canary-token": token,
      ...extraHeaders,
    });
    if (currentBody) {
      headers.set("content-type", "application/json");
    }

    const response = await fetchImpl(currentUrl, {
      method,
      headers,
      body: currentBody,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });

    if (response.status < 300 || response.status > 399) {
      return response;
    }

    currentUrl = validateRedirect(response.headers.get("location"), currentUrl);
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = "GET";
      currentBody = undefined;
    }
  }
}

/**
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ baseUrl: string, json: boolean, email: string | null, expectedWorkerVersionId: string | null, gateRunId: string | null }} */
  const parsed = {
    baseUrl: process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
    json: false,
    email: process.env.CANARY_BILLING_EMAIL || null,
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
    if (arg === "--email" && args[index + 1]) {
      parsed.email = args[index + 1];
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

/**
 * Validate the server's billing canary proof before treating the run as a
 * success. The endpoint currently owns snapshot/restore and does not expose
 * the exact pre-run state or affected-row counts, so those stronger checks
 * remain a server-contract dependency rather than being inferred here.
 *
 * @param {unknown} payload
 * @param {Response} response
 * @param {{ workerVersionId?: string | null, gateRunId?: string | null }} [expected]
 * @returns {{ ok: true } | { ok: false, blocker: string }}
 */
export function validateBillingCanaryResult(payload, response, expected = {}) {
  if (!response.ok) return { ok: false, blocker: "billing_canary_http_failure" };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, blocker: "billing_canary_invalid_response" };
  }

  const body = /** @type {{ ok?: unknown, workerVersionId?: unknown, gateRunId?: unknown, user?: { email?: unknown }, webhook?: { plan?: { status?: unknown }, proofCredits?: { status?: unknown } }, grants?: { paidPlanUnlocked?: unknown, planCleanupOk?: unknown, watchlistCleanupOk?: unknown, proofCreditsGranted?: unknown, proofCreditCleanupOk?: unknown, credits?: unknown } }} */ (payload);
  const grants = body.grants;
  const planWebhookStatus = body.webhook?.plan?.status;
  const creditWebhookStatus = body.webhook?.proofCredits?.status;
  const webhookStatusesValid = [planWebhookStatus, creditWebhookStatus].every(
    (status) => typeof status === "number" && status >= 200 && status < 300,
  );
  const credits = grants?.credits;
  const grantsValid =
    grants?.paidPlanUnlocked === true &&
    grants.planCleanupOk === true &&
    grants.watchlistCleanupOk === true &&
    grants.proofCreditsGranted === true &&
    grants.proofCreditCleanupOk === true &&
    typeof credits === "number" &&
    credits === 500;
  if (body.ok !== true || !webhookStatusesValid || !grantsValid) {
    return { ok: false, blocker: "billing_canary_proof_incomplete" };
  }
  if (
    (expected.workerVersionId && body.workerVersionId !== expected.workerVersionId) ||
    (expected.gateRunId && body.gateRunId !== expected.gateRunId)
  ) {
    return { ok: false, blocker: "billing_canary_identity_mismatch" };
  }

  return { ok: true };
}

/**
 * @param {{ config?: ReturnType<typeof parseArgs>, token?: string, fetchImpl?: typeof fetch }} [input]
 */
export async function runCanary({ config = parseArgs([]), token = process.env.CANARY_BYPASS_TOKEN?.trim(), fetchImpl = fetch } = {}) {
  if (!token) {
    throw new Error("Missing CANARY_BYPASS_TOKEN; source .dev.vars or set the secret before running this canary.");
  }
  if (!config.expectedWorkerVersionId) {
    throw new Error("Missing expected Worker version ID; refusing an unbound billing canary.");
  }
  if (!config.gateRunId || !/^[a-z0-9._-]{1,128}$/u.test(config.gateRunId)) {
    throw new Error("Missing or invalid gate run ID; refusing a non-resumable billing canary.");
  }

  const baseUrl = validateCanonicalBaseUrl(config.baseUrl);
  const body = JSON.stringify({
    ...(config.email ? { email: config.email } : {}),
    gateRunId: config.gateRunId,
  });
  const response = await fetchCanary({
    url: new URL("/api/billing/dodo/canary", baseUrl),
    token,
    body,
    extraHeaders: { "x-0509-expected-worker-version": config.expectedWorkerVersionId },
    fetchImpl,
  });
  const payload = await response.json().catch(() => null);

  return { payload, response };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  try {
    const { payload, response } = await runCanary({ config });
    const validation = validateBillingCanaryResult(payload, response, {
      workerVersionId: config.expectedWorkerVersionId,
      gateRunId: config.gateRunId,
    });
    if (config.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(formatReport(payload));
    }
    if (!validation.ok) {
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
