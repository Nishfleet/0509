#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://0509.io";
const REQUIRED_COUNTRIES = ["IN", "US", "GB"];
const DODO_PRICING_CANARY_TIMEOUT_MS = 20_000;

/**
 * @typedef {{
 *   display?: string,
 *   currency?: string,
 *   billingCountry?: string
 * }} PricingDisplay
 *
 * @typedef {{
 *   available?: boolean,
 *   country?: string,
 *   reason?: string,
 *   prices?: Record<string, Record<string, PricingDisplay | null | undefined> | null | undefined>,
 *   usageBundles?: Record<string, PricingDisplay | null | undefined>
 * }} PricingPreview
 *
 * @typedef {{
 *   requestedCountry: string,
 *   ok: boolean,
 *   status: number,
 *   previewCountry: string,
 *   currency: string,
 *   display: string,
 *   billingCountry: string,
 *   reason: string
 * }} PricingCanaryResult
 */

/**
 * @param {string[]} args
 * @returns {{ baseUrl: string, countries: string[], json: boolean }}
 */
function parseArgs(args) {
  const parsed = {
    baseUrl: process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
    countries: REQUIRED_COUNTRIES,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url" && args[index + 1]) {
      parsed.baseUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--country" && args[index + 1]) {
      parsed.countries = [args[index + 1].toUpperCase()];
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
 * @param {PricingPreview} preview
 */
function readFirstDisplay(preview) {
  for (const plan of Object.values(preview.prices ?? {})) {
    if (!plan) continue;
    for (const price of Object.values(plan)) {
      if (price?.display) {
        return price;
      }
    }
  }

  for (const price of Object.values(preview.usageBundles || {})) {
    if (price?.display) {
      return price;
    }
  }

  return null;
}

/**
 * @param {{ baseUrl: string, country: string, token: string }} input
 * @returns {Promise<PricingCanaryResult>}
 */
async function fetchPreview({ baseUrl, country, token }) {
  const url = new URL("/api/pricing-preview", baseUrl);
  url.searchParams.set("country", country);
  url.searchParams.set("pricing-canary", String(Date.now()));
  const response = await fetch(url, {
    headers: {
      "user-agent": "0509-dodo-pricing-canary/1.0",
      "x-0509-canary-token": token,
    },
    signal: AbortSignal.timeout(DODO_PRICING_CANARY_TIMEOUT_MS),
  });
  const body = /** @type {PricingPreview} */ (await response.json().catch(() => ({})));
  const firstPrice = readFirstDisplay(body);
  const billingCountry = firstPrice?.billingCountry || "";
  const billingCountryMatches = !billingCountry || billingCountry === country;
  return {
    requestedCountry: country,
    ok:
      response.ok &&
      body.available === true &&
      body.country === country &&
      Boolean(firstPrice) &&
      billingCountryMatches,
    status: response.status,
    previewCountry: body.country || "",
    currency: firstPrice?.currency || "",
    display: firstPrice?.display || "",
    billingCountry,
    reason: body.reason || "",
  };
}

/**
 * @param {PricingCanaryResult[]} results
 */
function formatReport(results) {
  const lines = [`Dodo pricing canary: ${results.every((result) => result.ok) ? "ok" : "failed"}`];
  for (const result of results) {
    lines.push(
      `${result.requestedCountry}: ${result.ok ? "ok" : "failed"} ` +
        `(status ${result.status}, preview ${result.previewCountry || "none"}, ` +
        `${result.currency || "no currency"} ${result.display || "no price"}, ` +
        `billing ${result.billingCountry || "none"}${result.reason ? `, ${result.reason}` : ""})`,
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

const results = await Promise.all(
  config.countries.map((country) => fetchPreview({ baseUrl: config.baseUrl, country, token })),
);

if (config.json) {
  console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
} else {
  console.log(formatReport(results));
}

if (!results.every((result) => result.ok)) {
  process.exitCode = 1;
}
