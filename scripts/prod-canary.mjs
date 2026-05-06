#!/usr/bin/env node

import {
  DEFAULT_CANARY_BASE_URL,
  DEFAULT_CANARY_EXPECTED_APP,
  formatProductionCanaryReport,
  runProductionCanary,
} from "./prod-canary.lib.mjs";

/**
 * @param {string | undefined} value
 * @returns {"advertiser" | "keyword" | undefined}
 */
function parseMode(value) {
  if (!value) {
    return undefined;
  }
  if (value === "advertiser" || value === "keyword") {
    return /** @type {"advertiser" | "keyword"} */ (value);
  }
  throw new Error(`Unsupported canary mode: ${value}`);
}

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  /** @type {{ baseUrl: string | undefined, expectedApp: string | null, queries: string[], mode: "advertiser" | "keyword" | undefined, canaryBypassToken: string | undefined, json: boolean }} */
  const parsed = {
    baseUrl: process.env.CANARY_BASE_URL || undefined,
    expectedApp: process.env.CANARY_EXPECTED_APP || DEFAULT_CANARY_EXPECTED_APP,
    queries: [],
    mode: parseMode(process.env.CANARY_MODE),
    canaryBypassToken: process.env.CANARY_BYPASS_TOKEN || undefined,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url" && args[index + 1]) {
      parsed.baseUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--query" && args[index + 1]) {
      parsed.queries.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--mode" && args[index + 1]) {
      parsed.mode = parseMode(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--expected-app" && args[index + 1]) {
      parsed.expectedApp = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
    }
  }

  return parsed;
}

const config = parseArgs(process.argv.slice(2));
const report = await runProductionCanary({
  baseUrl: config.baseUrl,
  expectedApp: config.expectedApp,
  queries: config.queries,
  mode: config.mode,
  canaryBypassToken: config.canaryBypassToken,
});

if (config.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatProductionCanaryReport(report));
}

if (!report.passed) {
  process.exitCode = 1;
}
