#!/usr/bin/env node

import {
  DEFAULT_COUNTRY,
  DEFAULT_MODE,
  DEFAULT_PROVIDERS,
  DOGFOOD_QUERIES,
  benchmarkProviders,
  findBlockingCurrent0509Failures,
  formatResultsTable,
} from "./provider-bakeoff.lib.mjs";

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  /** @type {{ providers: string[], queries: string[], country: string, mode: "advertiser" | "keyword", json: boolean, baseUrl: string | undefined }} */
  const parsed = {
    providers: [],
    queries: [],
    country: DEFAULT_COUNTRY,
    mode: DEFAULT_MODE,
    json: false,
    baseUrl: process.env.BAKEOFF_BASE_URL,
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
  };
}

const config = parseArgs(process.argv.slice(2));
const results = await benchmarkProviders({
  providers: /** @type {import("./provider-bakeoff.lib.mjs").ProviderName[]} */ (config.providers),
  queries: config.queries,
  country: config.country,
  mode: config.mode,
  baseUrl: config.baseUrl,
});
const blockingFailures = findBlockingCurrent0509Failures(results);

if (config.json) {
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        providers: config.providers,
        queries: config.queries,
        blockingFailures,
        results,
      },
      null,
      2,
    ),
  );
} else {
  console.log(formatResultsTable(results));
  if (blockingFailures.length > 0) {
    console.error(
      `\ncurrent_0509 failed the bakeoff gate for: ${blockingFailures
        .map((result) => `${result.query} (${result.status})`)
        .join(", ")}`,
    );
  }
}

if (blockingFailures.length > 0) {
  process.exitCode = 1;
}
