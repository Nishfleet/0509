#!/usr/bin/env node
// d1-budget: reads=0 writes=0 runs_per_day=10
/**
 * funnel-canary-check — post-enable canary for funnel measurement
 * (spec §8 gate 8, issue #2106).
 *
 * Production now sets FUNNEL_MEASUREMENT_ENABLED: "1" (see docs/ga-metrics.md
 * §"Funnel measurement status"). The spec §5 no-collection-path rule requires
 * the product to work identically for every visitor — including visitors whose
 * request carries the Global Privacy Control opt-out signal, which suppresses
 * all recording. This canary proves that after each deploy that ships the
 * enabled flag: it fetches the production homepage twice — once plain, once
 * with `Sec-GPC: 1` — and fails unless BOTH return HTTP 200.
 *
 * Run it post-deploy:
 *
 *   node scripts/funnel-canary-check.mjs
 *
 * Reads only — no writes to production state. Rollback plan on a red canary:
 * flip FUNNEL_MEASUREMENT_ENABLED back to "0" in wrangler.jsonc and redeploy.
 *
 * Exit codes:
 *   0 — both fetches returned HTTP 200 (canary green).
 *   1 — a fetch returned a non-200 status (canary red; consider rollback).
 *   2 — the check could not run (network failure).
 */
import { pathToFileURL } from "node:url";

/** Production origin under test — the exact surface a visitor sees. */
const DEFAULT_BASE_URL = "https://0509.io";

const USAGE = `Usage: node scripts/funnel-canary-check.mjs [--base-url <url>]

Post-enable canary for funnel measurement (spec §8 gate 8, issue #2106).
Fetches / with and without the "Sec-GPC: 1" Global Privacy Control header
and asserts both return HTTP 200. Reads only; no production state changes.

Options:
  --base-url <url>  Check a different origin (default: ${DEFAULT_BASE_URL}).
  --help            Print this help and exit 0.

Exit codes:
  0  both fetches returned HTTP 200 (canary green)
  1  a fetch returned a non-200 status (canary red; consider rollback)
  2  the check could not run (network failure)`;

/**
 * @param {string[]} argv
 * @returns {{baseUrl: string, help: boolean}}
 */
export function parseArgs(argv) {
  const parsed = { baseUrl: DEFAULT_BASE_URL, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--base-url" && argv[index + 1]) {
      parsed.baseUrl = argv[index + 1].replace(/\/+$/, "");
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}. Supported: --base-url <url>, --help.`);
  }
  return parsed;
}

/**
 * One homepage fetch, returning only the HTTP status. Network failures throw
 * (the caller maps them to exit 2 — a canary that cannot run must not pass).
 * @param {{baseUrl: string, headers: Record<string, string>}} input
 * @returns {Promise<number>}
 */
export async function fetchHomeStatus({ baseUrl, headers }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${baseUrl}/`, {
      headers,
      signal: controller.signal,
    });
    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const cases = [
    { label: "plain (no GPC)", headers: {} },
    { label: "Sec-GPC: 1 (opted out)", headers: { "Sec-GPC": "1" } },
  ];

  const failures = [];
  for (const testCase of cases) {
    let status;
    try {
      status = await fetchHomeStatus({ baseUrl: args.baseUrl, headers: testCase.headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`funnel-canary: ${testCase.label} fetch failed: ${message}`);
      return 2;
    }
    console.log(`funnel-canary: GET ${args.baseUrl}/ [${testCase.label}] -> HTTP ${status}`);
    if (status !== 200) {
      failures.push(`${testCase.label} returned HTTP ${status}, expected 200`);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`funnel-canary: FAIL ${failure}`);
    }
    console.error(
      'funnel-canary: red — rollback: set FUNNEL_MEASUREMENT_ENABLED to "0" in wrangler.jsonc and redeploy',
    );
    return 1;
  }

  console.log("funnel-canary: green — / serves 200 with and without Sec-GPC: 1");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Standalone invocation only — importing this module (e.g. from a test)
  // must not run the live check on import.
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`funnel-canary: ${message}`);
      process.exit(2);
    });
}
