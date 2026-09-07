#!/usr/bin/env node
/**
 * Live regression guard for issue #1930: a rate-limited /ads/:domain (or
 * /timeline/:domain) request must render the honest per-IP free-preview limit
 * state with a recovery path and forward Retry-After — never the generic
 * "Something broke on our side" root error boundary.
 *
 * The anonymous brand-page limiter (enforcePublicBrandPageRateLimit) allows
 * 120 page loads / 10 minutes per IP. When it trips, the route loader throws
 * an in-product 429 document whose body names the limit and whose headers
 * carry Retry-After. THIS canary is the prevention mechanism: it curls a
 * populated /ads page until the limiter trips, then asserts the honest body
 * (no "Something broke on our side") and the Retry-After header, and FAILS
 * (exit 1) the moment a regression reintroduces the generic error shell,
 * auto-filing a GitHub issue (--file-issue).
 *
 * The check is live against production 0509.io — the exact surface a buyer
 * sees — so it does not need D1 or a Cloudflare token. It only needs outbound
 * HTTPS and, when `--file-issue` is given, a working `gh` auth / GITHUB_TOKEN.
 *
 * Exit codes:
 *   0 — verdict passed (the tripped limiter rendered the honest body + header).
 *   1 — the tripped limiter rendered the generic error shell (optionally files).
 *   2 — the live check could not run (network / curl failure, or the limiter
 *       never tripped within the request cap).
 *
 * Reads only — no writes to production state. The domain and the honest-copy
 * markers are pinned here (not read from any mutable product config) so a
 * product regression that reintroduces the generic shell cannot also rename
 * itself out of the guard's sight.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Base URL for the live /ads surface under test. */
export const BASE_URL = "https://0509.io";

/**
 * A populated /ads/:domain page to drive until the limiter trips. Pinned here
 * (not read from any mutable config) so a product change cannot rename the
 * guard's target out of sight. nike.com is a seeded, populated brand page.
 */
export const BRAND_DOMAIN = "nike.com";

/**
 * The honest per-IP free-preview limit copy that must appear in the tripped
 * 429 body (mirrors PUBLIC_BRAND_PAGE_RATE_LIMIT_MESSAGE). The generic
 * "Something broke on our side" shell must NOT appear.
 */
export const HONEST_COPY_MARKERS = Object.freeze([
  "anonymous preview limit",
  "120 page loads per 10 minutes",
  "wait a few minutes and try again",
]);

/** The generic error-shell phrases that must never appear in a 429 body. */
export const BANNED_ERROR_SHELL_PHRASES = Object.freeze([
  "Something went wrong",
  "Something broke on our side",
]);

/**
 * The anonymous brand-page limiter allows 120 requests / 10 minutes per IP.
 * We drive the page until it trips, with a small headroom cap so a healthy
 * run always trips and a broken one fails loudly instead of looping forever.
 */
export const MAX_REQUESTS = 130;

/** Stable marker so the auto-filed issue is greppable and de-duplicable. */
export const ISSUE_BODY_MARKER = "public-brand-page-rate-limit-guard-incident";

const WRITE_PATH_REF =
  "app/routes/ads.$domain.tsx + app/routes/timeline.$domain.tsx (loader 429 throw + route headers() export)";

/**
 * @param {string[]} argv
 * @returns {{fileIssue: boolean, dryRun: boolean}}
 */
export function parseArgs(argv) {
  const parsed = { fileIssue: false, dryRun: false };
  for (const arg of argv) {
    if (arg === "--file-issue") {
      parsed.fileIssue = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Supported: --file-issue, --dry-run.`,
    );
  }
  return parsed;
}

/**
 * @param {{domain: string}} input
 * @returns {string} the /ads URL for the domain.
 */
export function buildBrandPageUrl({ domain }) {
  return `${BASE_URL}/ads/${globalThis.encodeURIComponent(domain)}`;
}

/**
 * Extract the rate-limit state from a fetched /ads response.
 * @param {{status: number, body: string, retryAfter: string | null}} input
 * @returns {{tripped: boolean, honest: boolean, genericShell: boolean,
 *   hasRetryAfter: boolean, body: string}}
 */
export function gradeRateLimitResponse({ status, body, retryAfter }) {
  const tripped = status === 429;
  const lower = body.toLowerCase();
  const honest = HONEST_COPY_MARKERS.every((marker) =>
    lower.includes(marker.toLowerCase()),
  );
  const genericShell = BANNED_ERROR_SHELL_PHRASES.some((phrase) =>
    lower.includes(phrase.toLowerCase()),
  );
  const hasRetryAfter = typeof retryAfter === "string" && retryAfter.length > 0;
  return { tripped, honest, genericShell, hasRetryAfter, body };
}

/**
 * @param {{checkedAt: string, status: number, honest: boolean,
 *   genericShell: boolean, hasRetryAfter: boolean, body: string}} input
 * @returns {string}
 */
export function buildIssueBody(input) {
  const lines = [];
  lines.push("## /ads rate-limit error-body regression (issue #1930 guard)");
  lines.push("");
  lines.push(
    "A rate-limited /ads/:domain (or /timeline/:domain) request again rendered the generic error shell instead of the honest per-IP free-preview limit state, or dropped Retry-After.",
  );
  lines.push("");
  lines.push(`- **checked at:** ${input.checkedAt}`);
  lines.push(`- **HTTP status:** ${input.status}`);
  lines.push(`- **honest copy present:** ${input.honest}`);
  lines.push(`- **generic shell present:** ${input.genericShell}`);
  lines.push(`- **Retry-After present:** ${input.hasRetryAfter}`);
  lines.push("");
  lines.push("### Observed body");
  lines.push("```");
  lines.push(input.body.slice(0, 2000));
  lines.push("```");
  lines.push("");
  lines.push("### Write path");
  lines.push(
    `The 429 body and Retry-After are produced by the route loaders and forwarded by the route headers() export: \`${WRITE_PATH_REF}\`. Restore the honest 429 throw + headers() forwarding and re-run \`scripts/canary-public-brand-page-rate-limit.mjs\`.`,
  );
  lines.push("");
  lines.push(`> run by \`scripts/canary-public-brand-page-rate-limit.mjs\` (scheduled by \`ops/public-brand-page-rate-limit-guard/\`).`);
  lines.push("");
  lines.push(`${ISSUE_BODY_MARKER}: true, status: ${input.status}, honest: ${input.honest}, genericShell: ${input.genericShell}, retryAfter: ${input.hasRetryAfter}`);
  return lines.join("\n");
}

/** @param {{body: string, title: string, repo: string}} input
 * @returns {string[]} */
export function buildGhIssueCommand({ body, title, repo }) {
  return ["issue", "create", "-R", repo, "--title", title, "--body", body];
}

/**
 * @param {{repo: string}} input
 * @returns {{existing: boolean}}
 */
export function findExistingOpenIncident({ repo }) {
  try {
    const result = spawnSync(
      "gh",
      ["issue", "list", "-R", repo, "--search", `${ISSUE_BODY_MARKER} in:body`, "--state", "open", "--json", "number", "--limit", "5"],
      { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (result.status !== 0) return { existing: false };
    const parsed = JSON.parse(result.stdout || "[]");
    return { existing: Array.isArray(parsed) && parsed.length > 0 };
  } catch {
    return { existing: false };
  }
}

/**
 * Fetch one /ads page and grade it. A failed fetch marks the whole run as
 * can't-run (exit 2): the guard must not silently pass because the site was
 * unreachable.
 * @param {{url: string}} input
 * @returns {Promise<{status: number, body: string, retryAfter: string | null}>}
 */
async function fetchBrandPage({ url }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    return {
      status: response.status,
      body,
      retryAfter: response.headers.get("retry-after"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkedAt = new Date().toISOString();
  const url = buildBrandPageUrl({ domain: BRAND_DOMAIN });

  // Drive the populated /ads page until the limiter trips (429), with a cap.
  // A healthy run trips within MAX_REQUESTS; a run that never trips means the
  // limiter is not engaging (a different regression) and must fail loudly.
  let last = null;
  for (let i = 1; i <= MAX_REQUESTS; i++) {
    let fetched;
    try {
      fetched = await fetchBrandPage({ url });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`public-brand-page-rate-limit canary: fetch failed: ${message}`);
      process.exit(2);
    }
    last = fetched;
    if (fetched.status === 429) break;
  }

  if (!last || last.status !== 429) {
    console.error(
      `public-brand-page-rate-limit canary: limiter never tripped after ${MAX_REQUESTS} requests to ${url} (last status ${last?.status ?? "none"}).`,
    );
    process.exit(2);
  }

  const grade = gradeRateLimitResponse(last);
  console.log(`status: ${last.status}`);
  console.log(`honest copy present: ${grade.honest}`);
  console.log(`generic shell present: ${grade.genericShell}`);
  console.log(`Retry-After present: ${grade.hasRetryAfter}`);
  console.log(`verdict: ${grade.honest && !grade.genericShell && grade.hasRetryAfter ? "pass" : "fail"}`);

  const passed = grade.honest && !grade.genericShell && grade.hasRetryAfter;
  if (!passed && args.fileIssue) {
    const repo = "Nishfleet/0509";
    const title = `/ads rate-limit error-body regression (${BRAND_DOMAIN})`;
    const body = buildIssueBody({
      checkedAt,
      status: last.status,
      honest: grade.honest,
      genericShell: grade.genericShell,
      hasRetryAfter: grade.hasRetryAfter,
      body: last.body,
    });
    const command = buildGhIssueCommand({ body, title, repo });
    if (args.dryRun) {
      console.log(`[dry-run] would run: gh ${command.map((c) => JSON.stringify(c)).join(" ")}`);
    } else {
      const existing = findExistingOpenIncident({ repo });
      if (existing.existing) {
        console.log(
          "auto-file skipped: an open public-brand-page-rate-limit-guard incident already exists (dedupe).",
        );
        process.exit(1);
      }
      const createResult = spawnSync("gh", command, {
        cwd: root,
        env: process.env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      if (createResult.status !== 0) {
        const message = (createResult.stderr || createResult.stdout || "").trim();
        console.log(`auto-file failed${message ? `: ${message}` : ""}`);
        process.exit(1);
      }
      console.log(`auto-filed: ${(createResult.stdout ?? "").trim()}`);
    }
  }

  process.exit(passed ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Standalone invocation only — the test suite imports this module (which
  // must not run the live check on import), and `void` avoids a top-level
  // await so the module stays sync-importable.
  main().then(() => process.exit(0)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`public-brand-page-rate-limit canary: ${message}`);
    process.exit(2);
  });
}
