/**
 * Pure pricing copy + data helpers for the pricing surfaces (issue #2967).
 *
 * Split out of `app/components/pricing-section.tsx` so the marketing route can
 * import the copy/JSON-LD helpers without pulling the whole React pricing
 * section into its static graph — `PricingSection` itself is lazy-mounted
 * below the fold on the homepage, so its chunk only loads when the visitor
 * reaches the plans. Everything here is framework-free and SSR-cheap.
 */

import { DODO_ANNUAL_SAVINGS_LABEL } from "~/lib/dodo-pricing-display";
import type { PricingBillingCycle, PricingPlanSlug } from "~/lib/pricing";
import { PUBLISHED_PLAN_PRICES_USD } from "~/lib/pricing";
import type { FaqJsonLdEntry } from "~/lib/seo";
import { SUPPORT_EMAIL } from "~/lib/support";
import type { LocalPricingPreview } from "~/components/pricing-section";

/**
 * Issue #2139 — sourced competitor entry prices for the "Price of knowing"
 * table under the plan cards. Every field is printed on the cited source
 * page; `tracked` and `cadence` appear only where the source prints them for
 * that tier. docs/compare-pricing-sources.md carries the same entries with
 * retrieval notes, and tests/compare-pages-sources.test.ts keeps the doc and
 * this list in sync.
 */
export type CompetitorPriceAnchor = {
  /** Vendor and entry tier as named on the source page. */
  vendor: string;
  /** Entry-tier price as printed, with currency and billing period. */
  price: string;
  /** Tracked-brand/page count — only when the source prints it for the tier. */
  tracked?: string;
  /** Check cadence — only when the source prints it for the tier. */
  cadence?: string;
  sourceUrl: string;
  /** Retrieval date, YYYY-MM-DD. */
  checked: string;
};

export const COMPETITOR_PRICE_ANCHORS: readonly CompetitorPriceAnchor[] = [
  {
    vendor: "Foreplay Basic",
    price: "$59/month",
    sourceUrl: "https://foreplay.co/pricing",
    checked: "2026-09-09",
  },
  {
    vendor: "Visualping Personal 1K",
    price: "$14/mo",
    tracked: "10 pages",
    cadence: "every 15 min",
    sourceUrl: "https://visualping.io/pricing",
    checked: "2026-09-09",
  },
  {
    vendor: "Panoramata Startup",
    price: "€99/month (billed monthly)",
    tracked: "up to 20 competitors",
    cadence: "daily and weekly summaries",
    sourceUrl: "https://panoramata.co/pricing",
    checked: "2026-09-09",
  },
  {
    vendor: "TrendTrack Starter",
    price: "42$ per month, billed yearly",
    tracked: "2 brands",
    cadence: "data refreshed every 24 hours",
    sourceUrl: "https://trendtrack.io/pricing",
    checked: "2026-09-09",
  },
  {
    vendor: "AdSpyder Spy",
    price: "$10/month",
    sourceUrl: "https://adspyder.io/pricing",
    checked: "2026-09-09",
  },
];

// Plain-text mirror of the rendered billing FAQ block for FAQPage JSON-LD.
// Keep in sync with the "Common billing questions" markup below.
export function billingFaqJsonLdEntries(agencySaleOpen: boolean): FaqJsonLdEntry[] {
  return [
    {
      question: "What uses proof captures?",
      answer:
        "Scheduled scans are included with your plan and never touch your cap. A proof capture is used when Five to Nine saves a confirmed change with page text, the original link, and a screenshot when the capture includes one.",
    },
    {
      question: "Do unused proof captures roll over?",
      answer:
        "Included proof captures reset every month and do not roll over — the caps are generous. Purchased proof captures never expire and carry over until you use them.",
    },
    {
      question: "What changes on Agency?",
      answer:
        "Agency includes 75 watchlists, 250 Collections, 2,500 proof captures/month, team seats, API/MCP access, client reports, and shared report branding.",
    },
    agencySaleOpen
      ? {
          question: "How does Agency checkout work?",
          answer: `Agency checkout is available when pricing loads in your region. Email ${SUPPORT_EMAIL} if you want an account review before buying.`,
        }
      : {
          question: "Why is Agency held?",
          answer: `Agency is available by account review. Email ${SUPPORT_EMAIL} and we will confirm fit directly.`,
        },
    {
      question: "Where do prices come from?",
      answer:
        "Published plan prices are shown on this page. Checkout shows the exact amount in your local currency, loaded from Dodo Payments at preview time.",
    },
  ];
}

function formatMinorCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined,
  options: { roundWhole?: boolean } = {},
) {
  if (!Number.isFinite(amount) || !currency) return "";
  try {
    const decimals =
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    const majorAmount = Number(amount) / 10 ** decimals;
    const displayAmount = options.roundWhole === false ? majorAmount : Math.ceil(majorAmount);
    const fractionDigits = options.roundWhole === false && Math.abs(displayAmount) < 10 ? 2 : 0;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: 0,
    }).format(displayAmount);
  } catch {
    return `${currency} ${Math.ceil(Number(amount) / 100)}`;
  }
}

export function valueMathLabel(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
  annualIsValid: boolean,
) {
  const monthlyPrice = preview?.prices?.[planId]?.monthly;
  if (cycle === "yearly" && annualIsValid) {
    const yearlyPrice = preview?.prices?.[planId]?.yearly;
    const monthlyAmount = monthlyPrice?.amount;
    const annualAmount = yearlyPrice?.amount;
    const monthlyCurrency = monthlyPrice?.currency;
    const annualCurrency = yearlyPrice?.currency;
    const savingsAmount =
      Number.isFinite(monthlyAmount) &&
      Number.isFinite(annualAmount) &&
      monthlyCurrency &&
      annualCurrency &&
      monthlyCurrency === annualCurrency
        ? Number(monthlyAmount) * 12 - Number(annualAmount)
        : null;
    const savings = savingsAmount && savingsAmount > 0
      ? formatMinorCurrency(savingsAmount, monthlyCurrency, { roundWhole: false })
      : "";
    return savings ? `Save ${savings} vs monthly` : DODO_ANNUAL_SAVINGS_LABEL;
  }

  const perDay = formatMinorCurrency(
    Number.isFinite(monthlyPrice?.amount)
      ? Number(monthlyPrice?.amount) / 30
      : PUBLISHED_PLAN_PRICES_USD[planId].monthly * 100 / 30,
    monthlyPrice?.currency || "USD",
    { roundWhole: false },
  );
  return perDay ? `About ${perDay}/day` : "Simple monthly start";
}

export function planIntentPath(
  signedIn: boolean,
  plan: PricingPlanSlug,
  cycle: PricingBillingCycle,
) {
  const billingPath = `/app/billing?plan=${plan}&cycle=${cycle}&source=pricing#plans`;
  if (signedIn) return billingPath;
  return `/auth/signup?redirectTo=${encodeURIComponent(billingPath)}`;
}
