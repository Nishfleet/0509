import { PLANS, TRIAL_TERMS } from "./billing/plans";
import {
  SITE_URL,
  breadcrumbJsonLd,
  jsonLdGraph,
  organizationJsonLd,
  softwareApplicationJsonLd,
} from "./structured-data";

const PRICING_PATH = "/pricing";
const START_SOURCES = ["organic", "llms", "share"] as const;

export type StartSource = (typeof START_SOURCES)[number];

export function startSource(url: URL): StartSource | null {
  const value = url.searchParams.get("utm_source");
  return START_SOURCES.find((source) => source === value) ?? null;
}

export function planNames(): string {
  return PLANS.map((plan) => plan.name).join(", ");
}

export function planPriceList(): string {
  return PLANS.map((plan) => `${plan.name} €${String(plan.monthlyPriceEur)}/month`).join(", ");
}

export function pricingMeta() {
  const title = "Pricing · Five to Nine";
  const description = `Five to Nine pricing: ${planPriceList()}. ${TRIAL_TERMS}`;
  const url = `${SITE_URL}${PRICING_PATH}`;
  return [
    { title },
    { name: "description", content: description },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Five to Nine" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    {
      "script:ld+json": jsonLdGraph([
        organizationJsonLd(),
        breadcrumbJsonLd([
          { name: "Five to Nine", path: "/" },
          { name: "Pricing", path: PRICING_PATH },
        ]),
        softwareApplicationJsonLd([]),
      ]),
    },
  ];
}
