#!/usr/bin/env node
// d1-budget: reads=10 writes=0 runs_per_day=10

import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://0509.io";
const REQUIRED_COUNTRIES = ["IN", "US", "GB"];
const REQUIRED_USAGE_BUNDLES = ["proof_500", "proof_2000", "proof_7500"];
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
 *   workerVersionId?: string | null,
 *   country?: string,
 *   reason?: string,
 *   prices?: Record<string, Record<string, PricingDisplay | null | undefined> | null | undefined>,
 *   annualValidation?: Record<string, {
 *     valid?: boolean,
 *     reason?: string,
 *     monthlyAmount?: number | null,
 *     annualAmount?: number | null,
 *     expectedAnnualAmount?: number | null,
 *     currency?: string | null,
 *     billingCountry?: string | null
 *   } | null | undefined>,
 *   commercialLaunch?: {
 *     scoutSaleOpen?: boolean,
 *     starterSaleOpen?: boolean,
 *     agencySaleOpen?: boolean
 *   } | null,
 *   usageBundles?: Record<string, PricingDisplay | null | undefined>
 * }} PricingPreview
 *
 * @typedef {{
 *   plan: string,
 *   ok: boolean,
 *   monthlyDisplay: string,
 *   annualDisplay: string,
 *   currency: string,
 *   billingCountry: string,
 *   failures: string[]
 * }} PlanPricingValidation
 *
 * @typedef {{
 *   bundle: string,
 *   ok: boolean,
 *   display: string,
 *   currency: string,
 *   billingCountry: string,
 *   failures: string[]
 * }} UsageBundlePricingValidation
 *
 * @typedef {{
 *   requestedCountry: string,
 *   ok: boolean,
 *   status: number,
 *   previewCountry: string,
 *   currency: string,
 *   display: string,
 *   billingCountry: string,
 *   reason: string,
 *   planValidations: PlanPricingValidation[],
 *   topUpValidations: UsageBundlePricingValidation[],
 *   workerVersionId: string | null
 * }} PricingCanaryResult
 */

/**
 * @param {string[]} args
 * @returns {{ baseUrl: string, countries: string[], json: boolean, expectedWorkerVersionId: string | null }}
 */
export function parseArgs(args) {
  const parsed = {
    baseUrl: process.env.CANARY_BASE_URL || DEFAULT_BASE_URL,
    countries: REQUIRED_COUNTRIES,
    json: false,
    expectedWorkerVersionId: process.env.CANARY_EXPECTED_WORKER_VERSION_ID || null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url" && args[index + 1]) {
      parsed.baseUrl = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-worker-version" && args[index + 1]) {
      parsed.expectedWorkerVersionId = args[index + 1];
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
 * @param {{ baseUrl: string, country: string, token: string, expectedWorkerVersionId: string }} input
 * @returns {Promise<PricingCanaryResult>}
 */
export async function fetchPreview({ baseUrl, country, token, expectedWorkerVersionId }) {
  const expectedVersion = expectedWorkerVersionId?.trim();
  if (!expectedVersion) {
    throw new Error("pricing_canary_worker_version_missing");
  }
  const url = new URL("/api/pricing-preview", baseUrl);
  url.searchParams.set("country", country);
  url.searchParams.set("pricing-canary", String(Date.now()));
  const response = await fetch(url, {
    headers: {
      "user-agent": "0509-dodo-pricing-canary/1.0",
      "x-0509-canary-token": token,
      "x-0509-expected-worker-version": expectedVersion,
    },
    signal: AbortSignal.timeout(DODO_PRICING_CANARY_TIMEOUT_MS),
  });
  const body = /** @type {PricingPreview} */ (await response.json().catch(() => ({})));
  return validatePricingPreviewBody({
    preview: body,
    requestedCountry: country,
    status: response.status,
    responseOk: response.ok,
    expectedWorkerVersionId: expectedVersion,
  });
}

/**
 * @param {{
 *   preview: PricingPreview,
 *   requestedCountry: string,
 *   status: number,
 *   responseOk: boolean
 *   expectedWorkerVersionId?: string | null
 * }} input
 * @returns {PricingCanaryResult}
 */
export function validatePricingPreviewBody({
  preview,
  requestedCountry,
  status,
  responseOk,
  expectedWorkerVersionId = null,
}) {
  const saleOpenPlans = saleOpenPlansForPreview(preview);
  const planValidations = saleOpenPlans.map((plan) =>
    validatePlanPricing(preview, plan, requestedCountry),
  );
  const topUpValidations = REQUIRED_USAGE_BUNDLES.map((bundle) =>
    validateUsageBundlePricing(preview, bundle, requestedCountry),
  );
  const firstValidPrice = planValidations.find((plan) => plan.monthlyDisplay)?.monthlyDisplay
    ? planValidations.find((plan) => plan.monthlyDisplay)
    : planValidations[0];
  return {
    requestedCountry,
    ok:
      responseOk &&
      preview.available === true &&
      (!expectedWorkerVersionId || preview.workerVersionId === expectedWorkerVersionId) &&
      preview.country === requestedCountry &&
      planValidations.every((plan) => plan.ok) &&
      topUpValidations.every((bundle) => bundle.ok),
    status,
    previewCountry: preview.country || "",
    currency: firstValidPrice?.currency || "",
    display: firstValidPrice?.monthlyDisplay || "",
    billingCountry: firstValidPrice?.billingCountry || "",
    reason: preview.reason || "",
    planValidations,
    topUpValidations,
    workerVersionId: preview.workerVersionId ?? null,
  };
}

/**
 * @param {PricingPreview} preview
 * @returns {string[]}
 */
export function saleOpenPlansForPreview(preview) {
  const commercialLaunch = preview.commercialLaunch;
  const plans = [];

  if (commercialLaunch?.scoutSaleOpen !== false) plans.push("scout");
  if (commercialLaunch?.starterSaleOpen !== false) plans.push("starter");
  if (commercialLaunch?.agencySaleOpen === true) plans.push("agency");

  return plans;
}

/**
 * @param {PricingPreview} preview
 * @param {string} plan
 * @param {string} country
 * @returns {PlanPricingValidation}
 */
export function validatePlanPricing(preview, plan, country) {
  const monthly = preview.prices?.[plan]?.monthly ?? null;
  const annual = preview.prices?.[plan]?.yearly ?? null;
  const annualValidation = preview.annualValidation?.[plan] ?? null;
  const failures = [];
  const monthlyCountry = normalizeCountry(monthly?.billingCountry);
  const annualCountry = normalizeCountry(annual?.billingCountry);
  const validationCountry = normalizeCountry(annualValidation?.billingCountry);
  const monthlyCurrency = normalizeCurrency(monthly?.currency);
  const annualCurrency = normalizeCurrency(annual?.currency);
  const validationCurrency = normalizeCurrency(annualValidation?.currency);
  const monthlyAmount = Number(annualValidation?.monthlyAmount);
  const annualAmount = Number(annualValidation?.annualAmount);
  const expectedAnnualAmount = Number(annualValidation?.expectedAnnualAmount);
  const fourMonthsFreeAmount = monthlyAmount * 8;

  if (!monthly?.display) failures.push("missing monthly price");
  if (!annual?.display) failures.push("missing annual price");
  if (!monthlyCurrency) failures.push("missing monthly currency");
  if (!annualCurrency) failures.push("missing annual currency");
  if (!validationCurrency) failures.push("missing annual validation currency");
  if (!monthlyCountry) failures.push("missing monthly country");
  if (!annualCountry) failures.push("missing annual country");
  if (!validationCountry) failures.push("missing annual validation country");
  if (monthlyCurrency && annualCurrency && monthlyCurrency !== annualCurrency) {
    failures.push(`annual currency ${annualCurrency}`);
  }
  if (monthlyCurrency && validationCurrency && monthlyCurrency !== validationCurrency) {
    failures.push(`annual validation currency ${validationCurrency}`);
  }
  if (monthlyCountry && monthlyCountry !== country) failures.push(`monthly country ${monthlyCountry}`);
  if (annualCountry && annualCountry !== country) failures.push(`annual country ${annualCountry}`);
  if (validationCountry && validationCountry !== country) {
    failures.push(`annual validation country ${validationCountry}`);
  }
  if (annualValidation?.valid !== true) failures.push("annual validation failed");
  if (annualValidation?.reason !== "valid_4_months_free") {
    failures.push(`annual reason ${annualValidation?.reason || "missing"}`);
  }
  if (!Number.isFinite(monthlyAmount) || !Number.isFinite(annualAmount)) {
    failures.push("missing validation amounts");
  } else if (annualAmount !== fourMonthsFreeAmount) {
    failures.push("annual amount is not monthly x 8");
  }
  if (Number.isFinite(expectedAnnualAmount) && expectedAnnualAmount !== fourMonthsFreeAmount) {
    failures.push("expected annual amount is not monthly x 8");
  }

  return {
    plan,
    ok: failures.length === 0,
    monthlyDisplay: monthly?.display || "",
    annualDisplay: annual?.display || "",
    currency: validationCurrency || monthlyCurrency || annualCurrency || "",
    billingCountry: validationCountry || monthlyCountry || annualCountry || "",
    failures,
  };
}

/**
 * @param {PricingPreview} preview
 * @param {string} bundle
 * @param {string} country
 * @returns {UsageBundlePricingValidation}
 */
export function validateUsageBundlePricing(preview, bundle, country) {
  const price = preview.usageBundles?.[bundle] ?? null;
  const billingCountry = normalizeCountry(price?.billingCountry);
  const failures = [];

  if (!price?.display) failures.push("missing bundle price");
  if (!price?.currency) failures.push("missing bundle currency");
  if (!billingCountry) failures.push("missing bundle country");
  if (billingCountry && billingCountry !== country) failures.push(`bundle country ${billingCountry}`);

  return {
    bundle,
    ok: failures.length === 0,
    display: price?.display || "",
    currency: price?.currency || "",
    billingCountry,
    failures,
  };
}

/**
 * @param {unknown} value
 */
export function normalizeCountry(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * @param {unknown} value
 */
export function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * @param {PricingCanaryResult[]} results
 */
export function formatReport(results) {
  const lines = [`Dodo pricing canary: ${results.every((result) => result.ok) ? "ok" : "failed"}`];
  for (const result of results) {
    lines.push(
      `${result.requestedCountry}: ${result.ok ? "ok" : "failed"} ` +
        `(status ${result.status}, preview ${result.previewCountry || "none"}, ` +
        `${result.currency || "no currency"} ${result.display || "no monthly price"}, ` +
        `billing ${result.billingCountry || "none"}, ` +
        `monthly/annual ${formatPlanValidations(result.planValidations)}, ` +
        `top-ups ${formatTopUpValidations(result.topUpValidations)}` +
        `${result.reason ? `, ${result.reason}` : ""})`,
    );
  }
  return lines.join("\n");
}

/**
 * @param {PlanPricingValidation[]} planValidations
 */
export function formatPlanValidations(planValidations) {
  return planValidations
    .map((plan) => {
      if (plan.ok) return `${plan.plan}: ok`;
      return `${plan.plan}: ${plan.failures.join("; ") || "failed"}`;
    })
    .join(", ");
}

/**
 * @param {UsageBundlePricingValidation[]} topUpValidations
 */
export function formatTopUpValidations(topUpValidations) {
  return topUpValidations
    .map((bundle) => {
      if (bundle.ok) return `${bundle.bundle}: ok`;
      return `${bundle.bundle}: ${bundle.failures.join("; ") || "failed"}`;
    })
    .join(", ");
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const config = parseArgs(args);
  const token = env.CANARY_BYPASS_TOKEN?.trim();
  if (!token) {
    console.error("Missing CANARY_BYPASS_TOKEN; source .dev.vars or set the secret before running this canary.");
    process.exitCode = 1;
    return;
  }
  if (!config.expectedWorkerVersionId) {
    console.error("Missing expected Worker version ID; refusing an unbound pricing canary.");
    process.exitCode = 1;
    return;
  }
  const expectedWorkerVersionId = config.expectedWorkerVersionId;

  const results = await Promise.all(
    config.countries.map((country) => fetchPreview({
      baseUrl: config.baseUrl,
      country,
      token,
      expectedWorkerVersionId,
    })),
  );

  if (config.json) {
    console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
  } else {
    console.log(formatReport(results));
  }

  if (!results.every((result) => result.ok)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
