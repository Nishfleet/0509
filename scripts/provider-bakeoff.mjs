#!/usr/bin/env node

import {
  DEFAULT_COUNTRY,
  DEFAULT_MODE,
  DEFAULT_PROVIDERS,
  DOGFOOD_QUERIES,
  FRESH_LIVE_CURRENT_0509_TIMEOUT_MS,
  benchmarkProviders,
  findBlockingCurrent0509Failures,
  findBlockingFreshLiveCurrent0509Failures,
  formatResultsTable,
} from "./provider-bakeoff.lib.mjs";

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  /** @type {{ providers: string[], queries: string[], country: string, mode: "advertiser" | "keyword", json: boolean, baseUrl: string | undefined, freshLiveCurrent: boolean, canaryBypassToken: string | undefined, timeoutMs: number | undefined }} */
  const parsed = {
    providers: [],
    queries: [],
    country: DEFAULT_COUNTRY,
    mode: DEFAULT_MODE,
    json: false,
    baseUrl: process.env.BAKEOFF_BASE_URL,
    freshLiveCurrent: process.env.BAKEOFF_FRESH_LIVE_CURRENT === "true",
    canaryBypassToken: process.env.CANARY_BYPASS_TOKEN,
    timeoutMs: parsePositiveInteger(process.env.BAKEOFF_TIMEOUT_MS),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--provider" && args[index + 1]) {
      parsed.providers.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--query" && args[index + 1]) {
      parsed.queries.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--country" && args[index + 1]) {
      parsed.country = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--mode" && args[index + 1] && ["advertiser", "keyword"].includes(args[index + 1])) {
      parsed.mode = /** @type {"advertiser" | "keyword"} */ (args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--base-url" && args[index + 1]) {
      parsed.baseUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
    }
    if (arg === "--fresh-live-current" || arg === "--launch-gate") {
      parsed.freshLiveCurrent = true;
    }
    if (arg === "--timeout-ms" && args[index + 1]) {
      parsed.timeoutMs = parsePositiveInteger(args[index + 1]);
      index += 1;
    }
  }

  return {
    providers:
      parsed.providers.length > 0
        ? parsed.providers.map((provider) => {
            if (provider === "browserless") {
              return "browserless_bql";
            }
            if (provider === "browserbase") {
              return "browserbase";
            }
            if (provider === "brightdata" || provider === "bright_data") {
              return "brightdata";
            }
            if (provider === "zyte") {
              return "zyte_api";
            }
            return provider;
          })
        : [...DEFAULT_PROVIDERS],
    queries: parsed.queries.length > 0 ? parsed.queries : [...DOGFOOD_QUERIES],
    country: parsed.country,
    mode: parsed.mode,
    json: parsed.json,
    baseUrl: parsed.baseUrl,
    freshLiveCurrent: parsed.freshLiveCurrent,
    canaryBypassToken: parsed.canaryBypassToken,
    timeoutMs:
      parsed.timeoutMs ??
      (parsed.freshLiveCurrent ? FRESH_LIVE_CURRENT_0509_TIMEOUT_MS : undefined),
  };
}

/**
 * @param {string | undefined} value
 */
function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const config = parseArgs(process.argv.slice(2));
const results = await benchmarkProviders({
  providers: /** @type {import("./provider-bakeoff.lib.mjs").ProviderName[]} */ (config.providers),
  queries: config.queries,
  country: config.country,
  mode: config.mode,
  baseUrl: config.baseUrl,
  forceLive: config.freshLiveCurrent,
  canaryBypassToken: config.canaryBypassToken,
  timeoutMs: config.timeoutMs,
});
const blockingFailures = config.freshLiveCurrent
  ? findBlockingFreshLiveCurrent0509Failures(results)
  : findBlockingCurrent0509Failures(results);
const configurationFailures =
  config.freshLiveCurrent &&
  config.providers.includes("current_0509") &&
  !config.canaryBypassToken?.trim()
    ? [
        {
          code: "missing_canary_bypass_token",
          message:
            "Set CANARY_BYPASS_TOKEN to prove current_0509 bypassed cache and provider cooldown.",
        },
      ]
    : [];

if (config.json) {
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        providers: config.providers,
        queries: config.queries,
        current0509Gate: config.freshLiveCurrent ? "fresh_live" : "rendered_results",
        freshLiveBypassConfigured: Boolean(config.canaryBypassToken?.trim()),
        timeoutMs: config.timeoutMs ?? null,
        configurationFailures,
        blockingFailures,
        results,
      },
      null,
      2,
    ),
  );
} else {
  if (config.freshLiveCurrent) {
    console.log(
      `current_0509 gate: fresh live (${config.canaryBypassToken?.trim() ? "token configured" : "token missing"})`,
    );
  }
  console.log(formatResultsTable(results));
  for (const failure of configurationFailures) {
    console.error(`\nconfiguration failed: ${failure.message}`);
  }
  if (blockingFailures.length > 0) {
    console.error(
      `\ncurrent_0509 failed the bakeoff gate for: ${blockingFailures
        .map((result) => `${result.query} (${result.status})`)
        .join(", ")}`,
    );
  }
}

if (configurationFailures.length > 0 || blockingFailures.length > 0) {
  process.exitCode = 1;
}
