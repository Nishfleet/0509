#!/usr/bin/env node
// d1-budget: reads=100 writes=0 runs_per_day=10

import {
  DEFAULT_CANARY_BASE_URL,
  DEFAULT_CANARY_EXPECTED_APP,
  formatProductionCanaryReport,
  runProductionCanary,
} from "./prod-canary.lib.mjs";

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  /** @type {{ baseUrl: string | undefined, expectedApp: string | null, expectedWorkerVersionId: string | null, expectedSearchRolloutMode: string, queries: string[], json: boolean, searchTimeoutMs: number | undefined, metaAdsStrict: boolean }} */
  const parsed = {
    baseUrl: process.env.CANARY_BASE_URL || undefined,
    expectedApp: process.env.CANARY_EXPECTED_APP || DEFAULT_CANARY_EXPECTED_APP,
    expectedWorkerVersionId: process.env.CANARY_EXPECTED_WORKER_VERSION_ID || null,
    expectedSearchRolloutMode: process.env.CANARY_EXPECTED_SEARCH_ROLLOUT_MODE || "v2",
    queries: [],
    json: false,
    searchTimeoutMs: parsePositiveInteger(process.env.CANARY_SEARCH_TIMEOUT_MS),
    metaAdsStrict: parseBoolean(process.env.CANARY_META_ADS_STRICT),
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
    if (arg === "--expected-app" && args[index + 1]) {
      parsed.expectedApp = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-worker-version" && args[index + 1]) {
      parsed.expectedWorkerVersionId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-search-rollout-mode" && args[index + 1]) {
      parsed.expectedSearchRolloutMode = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
    }
    if (arg === "--search-timeout-ms" && args[index + 1]) {
      parsed.searchTimeoutMs = parsePositiveInteger(args[index + 1]);
      index += 1;
    }
    if (arg === "--meta-ads-strict") {
      parsed.metaAdsStrict = true;
    }
  }

  return parsed;
}

/**
 * @param {string | undefined} value
 */
function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * @param {string | undefined} value
 */
function parseBoolean(value) {
  return value === "1" || value?.toLowerCase() === "true";
}

const config = parseArgs(process.argv.slice(2));
const report = await runProductionCanary({
  baseUrl: config.baseUrl,
  expectedApp: config.expectedApp,
  expectedWorkerVersionId: config.expectedWorkerVersionId,
  expectedSearchRolloutMode: config.expectedSearchRolloutMode,
  queries: config.queries,
  canaryBypassToken: process.env.CANARY_BYPASS_TOKEN,
  searchTimeoutMs: config.searchTimeoutMs,
  metaAdsStrict: config.metaAdsStrict,
});

if (config.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatProductionCanaryReport(report));
}

if (!report.passed) {
  process.exitCode = 1;
}
