#!/usr/bin/env node
/**
 * Locale-prefix buyer-surface canary CLI (issue #1501).
 *
 * Wraps `scripts/canary-locale-prefix-routes.lib.mjs` for the operator
 * canary lane. The library owns the probe loop + report shape; this
 * file owns CLI parsing and the process exit code. Keeping them apart
 * means the unit test can exercise every probe shape without spawning
 * a child process or stubbing the script module.
 *
 * Usage:
 *   node scripts/canary-locale-prefix-routes.mjs
 *   CANARY_BASE_URL=https://preview.example.com \
 *     node scripts/canary-locale-prefix-routes.mjs
 *   node scripts/canary-locale-prefix-routes.mjs --base-url https://...
 */

import {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  formatReport,
  runCanary,
} from "./canary-locale-prefix-routes.lib.mjs";

function parseArgs(argv) {
  /** @type {{ baseUrl: string, timeoutMs: number, json: boolean }} */
  const parsed = {
    baseUrl: process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs: Number.parseInt(process.env.CANARY_TIMEOUT_MS || "", 10) || DEFAULT_TIMEOUT_MS,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url" && argv[index + 1]) {
      parsed.baseUrl = argv[index + 1];
      index += 1;
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      parsed.timeoutMs = Number.parseInt(argv[index + 1], 10) || DEFAULT_TIMEOUT_MS;
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    }
  }
  return parsed;
}

const config = parseArgs(process.argv.slice(2));
const report = await runCanary(config);

if (config.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatReport(report));
}

if (!report.passed) {
  process.exitCode = 1;
}
