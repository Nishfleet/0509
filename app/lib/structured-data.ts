import { PLANS } from "./billing/plans";
import { FEATURES } from "./coverage";
import type { FaqEntry } from "./faq";

export const SITE_URL = "https://0509.io";

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

export function organizationJsonLd() {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "Five to Nine",
    url: SITE_URL,
    logo: `${SITE_URL}/logo.svg`,
  };
}

export function websiteJsonLd() {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "Five to Nine",
    alternateName: "0509",
    url: SITE_URL,
    publisher: { "@id": ORGANIZATION_ID },
  };
}

export function softwareApplicationJsonLd() {
  return {
    "@type": "SoftwareApplication",
    name: "Five to Nine",
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    featureList: FEATURES,
    publisher: { "@id": ORGANIZATION_ID },
    offers: PLANS.map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      price: plan.monthlyPriceEur.toFixed(2),
      priceCurrency: "EUR",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: plan.monthlyPriceEur.toFixed(2),
        priceCurrency: "EUR",
        unitCode: "MON",
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
      },
      url: `${SITE_URL}/`,
    })),
  };
}

export function faqPageJsonLd(entries: readonly FaqEntry[]) {
  return {
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: SITE_URL + item.path,
    })),
  };
}

export function jsonLdGraph(nodes: readonly object[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
