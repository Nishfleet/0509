import { BUYER_SURFACE_CHILD_PATHS, BUYER_SURFACE_LOCALE_IDS, SNEAKER_RESALE_MARKETS } from "~/lib/locale-markets";
import {
  PUBLISHED_BUNDLE_PRICES_EUR,
  PUBLISHED_FREE_PLAN_OFFER,
  PUBLISHED_PLAN_PRICES_EUR,
  type PricingPlanSlug,
  type UsageBundleSlug,
} from "~/lib/pricing";
import { TOP_UP_PACK_DISPLAY } from "~/lib/billing-sku-catalog";

const SITE_ORIGIN = "https://0509.io";
const SITE_NAME = "Five to Nine";
// PNG, not SVG: most social scrapers (WhatsApp, Slack, X, iMessage) refuse
// SVG og:images. The legacy /social-card.svg stays served for cached links.
const SOCIAL_IMAGE_PATH = "/og-image.png";
const SOCIAL_IMAGE_URL = `${SITE_ORIGIN}${SOCIAL_IMAGE_PATH}`;
const LEGACY_SOCIAL_CARD_PATH = "/social-card.svg";
const SOCIAL_IMAGE_ALT = "Five to Nine competitor offer monitoring preview";

export function canonicalUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const pathOnly = normalizedPath.split(/[?#]/)[0] ?? "/";
  const withoutTrailingSlash =
    pathOnly === "/" ? pathOnly : pathOnly.replace(/\/+$/, "");

  return `${SITE_ORIGIN}${withoutTrailingSlash || "/"}`;
}

export function canonicalLinks(pathname: string) {
  return [{ rel: "canonical", href: canonicalUrl(pathname) }];
}

/**
 * Canonical consolidation for the duplicate /compare/* pairs (issue #1481).
 *
 * Every entry maps a loser URL to the winner it must canonicalize to. The
 * winners (`visualping-ad-library`, `foreplay-spyder`) name the narrower
 * buyer intent, so the generic `vs Visualping` / `vs Foreplay` pages point
 * their `rel="canonical"` at them. Losers stay live HTTP-200 pages (existing
 * backlinks and /switch links keep working) but carry the winner canonical
 * and are dropped from the sitemap, so Google consolidates each pair instead
 * of splitting PageRank between two near-identical SERP targets.
 */
export const COMPARE_CANONICAL_TARGETS: Readonly<Record<string, string>> = {
  "/compare/visualping": "/compare/visualping-ad-library",
  "/compare/foreplay": "/compare/foreplay-spyder",
};

/**
 * Reciprocal hreflang set for the sneaker-resale cluster, including self and
 * x-default (English). Google ignores one-way annotations.
 * https://developers.google.com/search/docs/specialty/international/localized-versions
 */
export function sneakerResaleHreflangLinks() {
  return [
    ...SNEAKER_RESALE_MARKETS.map((market) => ({
      rel: "alternate" as const,
      hrefLang: market.hreflang,
      href: canonicalUrl(market.pathname),
    })),
    {
      rel: "alternate" as const,
      hrefLang: "x-default",
      href: canonicalUrl("/sneaker-resale"),
    },
  ];
}

/**
 * Reciprocal hreflang set for the buyer-surface cluster (issue #1501).
 *
 * `splat` is the locale-prefix subpath (e.g. `"pricing"`, `"help"`, or
 * `""` for the locale index). The function emits self + sibling locale
 * entries pointing at the same subpath in each locale, plus the EN
 * (x-default) version. The buyer-surface cluster is broader than the
 * sneaker-resale cluster (fr/es are pre-evidence for the broader
 * marketing surface) and uses the same hreflang recipe.
 *
 * Google ignores one-way annotations, so the EN-side `rel=canonical`
 * pointing at the EN subpath does the heavy lifting; this function
 * exists so the cluster is reciprocal on both ends.
 */
export function buyerSurfaceHreflangLinks(splat: string) {
  const enPath = splat === "" ? "/" : splat === "api/docs" ? "/api/docs" : `/${splat}`;
  return [
    ...BUYER_SURFACE_LOCALE_IDS.map((locale) => ({
      rel: "alternate" as const,
      hrefLang: locale,
      href: canonicalUrl(splat === "" ? `/${locale}` : `/${locale}/${splat}`),
    })),
    {
      rel: "alternate" as const,
      hrefLang: "x-default",
      href: canonicalUrl(enPath),
    },
  ];
}

export function publicSeoMeta(input: {
  title: string;
  description: string;
  pathname: string;
  ogLocale?: string;
}) {
  const url = canonicalUrl(input.pathname);

  return [
    { title: input.title },
    { name: "description", content: input.description },
    ...(input.ogLocale ? [{ property: "og:locale", content: input.ogLocale }] : []),
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: "website" },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: url },
    { property: "og:image", content: SOCIAL_IMAGE_URL },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: SOCIAL_IMAGE_ALT },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: SOCIAL_IMAGE_URL },
    { name: "twitter:image:alt", content: SOCIAL_IMAGE_ALT },
  ];
}

/**
 * `<meta name="robots" content="noindex">` descriptor for auth/action
 * surfaces that must never be Google-indexable: signup, login, magic-link
 * confirm, password-reset, billing portal. Auth surfaces leak the entry
 * point to scrapers, burn crawl budget, and can outrank `/` or `/auth/signup`
 * for branded "five to nine sign in" queries — so every rendering auth route
 * appends this entry to its `meta` array alongside its `publicSeoMeta(...)`
 * entries. The canonical tag stays (noindex is the correct fix, not removing
 * canonical); these surfaces also stay out of `SITEMAP_PATHS`. Shared here so
 * every auth route uses one source of truth instead of re-inlining the tag.
 */
export function noindexMetaEntry() {
  return { name: "robots", content: "noindex" } as const;
}

export interface FaqJsonLdEntry {
  question: string;
  answer: string;
}

/**
 * schema.org Organization for the landing page. Deliberately minimal — no
 * price amounts anywhere in structured data (prices are live-loaded from
 * Dodo in the buyer's currency and must never be hardcoded).
 */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_ORIGIN,
  } as const;
}

/** schema.org WebSite with the public search preview as the site search action.
 *
 * Uses schema.org `query-input: required name=search_term_string` (the
 * standard `q` template) so a Google sitelink substituting the visible
 * `nike` (or any other brand term) lands on `/search?q=nike` and runs the
 * same first-value search the visitor would get by typing it on the
 * homepage. The earlier `?website={website}` template was rejected as an
 * incomplete domain by `hasInvalidCompetitorWebsite`, so the search never
 * ran and the H1 stayed idle. Watchlist, onboarding, and the website form
 * field keep requiring a real domain — only the public sitelink-shaped
 * sitelink target now uses the search-term slot. */
export function webSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_ORIGIN,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  } as const;
}

/**
 * schema.org FAQPage. Pass every FAQ block on the page in one call — Google
 * expects a single FAQPage entity per page, so the landing page combines the
 * product and billing FAQ entries into one mainEntity list.
 */
export function faqPageJsonLd(entries: ReadonlyArray<FaqJsonLdEntry>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: entry.answer,
      },
    })),
  } as const;
}

/**
 * schema.org WebPage for a public informational page. Deliberately plain: it
 * states only what the page already shows — its name, its description, and the
 * site it belongs to. The audit found no structured data on /help, /docs or
 * /status; this closes that without asserting anything the visible page does
 * not already say.
 *
 * The optional fields follow the same rule — they are emitted ONLY when the
 * visible page itself carries the claim:
 * - `dateModified`: the ISO timestamp of the last content update the page
 *   visibly stamps (e.g. the cached-check time on /ads/:domain). Omitted when
 *   the page has no such stamp — never invented.
 * - `aboutName`: the subject of the page when it is about a specific brand
 *   (e.g. the /ads/:domain brand pages). Must match a name the page shows.
 * - `comparedProductName`: the competitor product a `/compare/*` page is
 *   about. Emitted as `SoftwareApplication` `mainEntity` with only the name
 *   the page already shows — never ratings, prices, or review counts.
 */
export function webPageJsonLd(input: {
  name: string;
  description: string;
  pathname: string;
  dateModified?: string;
  aboutName?: string;
  comparedProductName?: string;
  /**
   * A `Dataset` (or other `CreativeWork`) this page has as a citable part.
   * The `/ads/:domain` brand page sets this to its Offer Timeline `Dataset`
   * when the page is indexable and a stored timeline exists, so answer
   * engines can follow the relationship from the brand page to the
   * change-ledger dataset (issue #964).
   */
  hasPart?: Record<string, unknown>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.name,
    description: input.description,
    url: canonicalUrl(input.pathname),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    ...(input.aboutName
      ? { about: { "@type": "Organization", name: input.aboutName } }
      : {}),
    ...(input.comparedProductName
      ? {
          mainEntity: {
            "@type": "SoftwareApplication",
            name: input.comparedProductName,
          },
        }
      : {}),
    ...(input.hasPart ? { hasPart: input.hasPart } : {}),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_ORIGIN },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_ORIGIN },
  } as const;
}

/**
 * schema.org BreadcrumbList for a public informational page. Emitted on
 * indexable multi-level pages (e.g. /timeline/:domain) so Google can show a
 * breadcrumb in the rich result. Every `item` is the canonical URL of the
 * corresponding pathname — the same canonical the page itself links — so the
 * crumbs can never point at a strayhost or query-parameter variant. The last
 * crumb is the page itself (its canonical URL), which the rich-results
 * validator accepts as the current position.
 */
export function breadcrumbJsonLd(input: {
  items: ReadonlyArray<{ name: string; pathname: string }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: input.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: canonicalUrl(item.pathname),
    })),
  } as const;
}

/**
 * schema.org Product+Offer pair for a /pricing tier or proof pack (#1503).
 *
 * Returns a single Product entity with one nested Offer; the Offer carries
 * the published stable EUR list price (PUBLISHED_PLAN_PRICES_EUR /
 * PUBLISHED_BUNDLE_PRICES_EUR) plus a priceValidUntil note that the figure
 * is the published list price, not the live Dodo Payments checkout amount
 * (which can drift by locale, SKU, and tax-inclusion settings). The
 * pricingOffersJsonLd() builder below emits one of these for every tier
 * card (Free, Scout, Starter, Agency) and every proof pack (Burst 500,
 * Campaign 2000, Scale 7500) so Google can render price-rich search
 * results without inheriting the live Dodo drift.
 *
 * Price type is a stringified positive integer (schema.org requires
 * `price` be a string for offers and accepts the integer canonicalization
 * Google rich-results expects). Free is intentionally a "0" so the search
 * row matches the visible free card on /pricing and never reads as
 * "missing price" in the structured-data test.
 */
function pricingProductOfferJsonLd(input: {
  productName: string;
  productDescription: string;
  productUrl: string;
  priceEUR: number;
  priceValidUntilNote: string;
  sku?: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.productName,
    description: input.productDescription,
    url: input.productUrl,
    ...(input.sku ? { sku: input.sku } : {}),
    brand: { "@type": "Brand", name: SITE_NAME },
    offers: {
      "@type": "Offer",
      price: String(input.priceEUR),
      priceCurrency: "EUR",
      priceValidUntil: "2030-12-31",
      availability: "https://schema.org/InStock",
      url: input.productUrl,
      seller: { "@type": "Organization", name: SITE_NAME, url: SITE_ORIGIN },
      eligibleRegion: { "@type": "Country", name: "DE" },
      category: "https://schema.org/Subscription",
      note: input.priceValidUntilNote,
    },
  } as const;
}

function planDescriptionForPricingOffer(plan: PricingPlanSlug): string {
  if (plan === "scout") {
    return "6-hour competitor monitoring for 3 watchlists, weekly brief, and 50 proof captures per month.";
  }
  if (plan === "starter") {
    return "3-hour competitor monitoring for 10 watchlists, daily and weekly briefs, and 250 proof captures per month.";
  }
  return "75 watchlists scanned every 3 hours, daily and weekly briefs, 2,500 proof captures per month, plus team seats, API and MCP access, client reports, and shared report branding.";
}

function planUsageBundleSlugForPricingOffer(plan: PricingPlanSlug): string {
  if (plan === "scout") return "scout_monthly_v1";
  if (plan === "starter") return "starter_monthly_v1";
  return "agency_monthly_v1";
}

const PRICING_OFFERS_PAGE_URL = `${SITE_ORIGIN}/pricing`;

const PRICING_FREE_OFFER = pricingProductOfferJsonLd({
  productName: PUBLISHED_FREE_PLAN_OFFER.name,
  productDescription: PUBLISHED_FREE_PLAN_OFFER.description,
  productUrl: PRICING_OFFERS_PAGE_URL,
  priceEUR: PUBLISHED_FREE_PLAN_OFFER.offerPriceEUR,
  priceValidUntilNote:
    "Published list price for the Free Five to Nine tier. No card required.",
});

const PRICING_TIER_OFFERS: Record<PricingPlanSlug, Record<string, unknown>> = {
  scout: pricingProductOfferJsonLd({
    productName: "Scout",
    productDescription: planDescriptionForPricingOffer("scout"),
    productUrl: PRICING_OFFERS_PAGE_URL,
    sku: planUsageBundleSlugForPricingOffer("scout"),
    priceEUR: PUBLISHED_PLAN_PRICES_EUR.scout.monthly,
    priceValidUntilNote:
      "Published EUR list price for the Scout monthly plan. Localized amount at checkout may differ by region and SKU.",
  }),
  starter: pricingProductOfferJsonLd({
    productName: "Starter",
    productDescription: planDescriptionForPricingOffer("starter"),
    productUrl: PRICING_OFFERS_PAGE_URL,
    sku: planUsageBundleSlugForPricingOffer("starter"),
    priceEUR: PUBLISHED_PLAN_PRICES_EUR.starter.monthly,
    priceValidUntilNote:
      "Published EUR list price for the Starter monthly plan. Localized amount at checkout may differ by region and SKU.",
  }),
  agency: pricingProductOfferJsonLd({
    productName: "Agency",
    productDescription: planDescriptionForPricingOffer("agency"),
    productUrl: PRICING_OFFERS_PAGE_URL,
    sku: planUsageBundleSlugForPricingOffer("agency"),
    priceEUR: PUBLISHED_PLAN_PRICES_EUR.agency.monthly,
    priceValidUntilNote:
      "Published EUR list price for the Agency monthly plan. Localized amount at checkout may differ by region and SKU.",
  }),
};

const USAGE_BUNDLE_SLUGS_FOR_PRICING_OFFER: ReadonlyArray<UsageBundleSlug> = [
  "proof_500",
  "proof_2000",
  "proof_7500",
];

const PRICING_BUNDLE_OFFERS: Record<UsageBundleSlug, Record<string, unknown>> = {
  proof_500: pricingProductOfferJsonLd({
    productName: TOP_UP_PACK_DISPLAY.burst_500_v1.name,
    productDescription: TOP_UP_PACK_DISPLAY.burst_500_v1.detail,
    productUrl: PRICING_OFFERS_PAGE_URL,
    sku: "burst_500_v1",
    priceEUR: PUBLISHED_BUNDLE_PRICES_EUR.proof_500,
    priceValidUntilNote:
      "Published EUR list price for the Burst 500 proof-capture pack.",
  }),
  proof_2000: pricingProductOfferJsonLd({
    productName: TOP_UP_PACK_DISPLAY.campaign_2000_v1.name,
    productDescription: TOP_UP_PACK_DISPLAY.campaign_2000_v1.detail,
    productUrl: PRICING_OFFERS_PAGE_URL,
    sku: "campaign_2000_v1",
    priceEUR: PUBLISHED_BUNDLE_PRICES_EUR.proof_2000,
    priceValidUntilNote:
      "Published EUR list price for the Campaign 2000 proof-capture pack.",
  }),
  proof_7500: pricingProductOfferJsonLd({
    productName: TOP_UP_PACK_DISPLAY.scale_7500_v1.name,
    productDescription: TOP_UP_PACK_DISPLAY.scale_7500_v1.detail,
    productUrl: PRICING_OFFERS_PAGE_URL,
    sku: "scale_7500_v1",
    priceEUR: PUBLISHED_BUNDLE_PRICES_EUR.proof_7500,
    priceValidUntilNote:
      "Published EUR list price for the Scale 7500 proof-capture pack.",
  }),
};

/**
 * schema.org Product+Offer JSON-LD payload for /pricing (#1503). Emits one
 * Product entity per tier card and per proof pack, every Offer priced in
 * EUR with stable published list values. Returned as an array so the
 * route can render it via a single `<script type="application/ld+json">`
 * with an `@graph` root. 4 tier Offers + 3 pack Offers = 7 total,
 * matching the issue's verify command threshold
 * (>= 7 occurrences of `"@type":"Offer"`).
 *
 * Order is stable: Free, Scout, Starter, Agency, Burst 500, Campaign
 * 2000, Scale 7500 — so the JSON-LD block reads in the same order as the
 * visible /pricing cards, and a regression can be spotted by reading the
 * structured data top-to-bottom.
 */
export function pricingOffersJsonLd(): ReadonlyArray<Record<string, unknown>> {
  return [
    PRICING_FREE_OFFER,
    PRICING_TIER_OFFERS.scout,
    PRICING_TIER_OFFERS.starter,
    PRICING_TIER_OFFERS.agency,
    ...USAGE_BUNDLE_SLUGS_FOR_PRICING_OFFER.map((slug) => PRICING_BUNDLE_OFFERS[slug]),
  ];
}

/**
 * schema.org Service for an indexable /ads/:domain brand page. Describes the
 * per-competitor ad-monitoring offer the page already shows: Watch {domain},
 * the brand the page is about, the canonical URL, and Five to Nine as the
 * provider. Description must be the same string as the visible meta
 * description (brandPageDescription) — never a second invented claim.
 *
 * Do not add price, rating, or availability fields. The page says the watch
 * is free, but prices live in Dodo and must not be hardcoded in structured
 * data (same rule as organizationJsonLd).
 */
export function adsPageServiceJsonLd(input: {
  brandName: string;
  domain: string;
  description: string;
  pathname: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Watch ${input.domain}`,
    description: input.description,
    url: canonicalUrl(input.pathname),
    provider: { "@type": "Organization", name: SITE_NAME, url: SITE_ORIGIN },
    about: { "@type": "Organization", name: input.brandName },
  } as const;
}

/**
 * schema.org `Dataset` for the public Offer Timeline (`/timeline/:domain`).
 *
 * The timeline is the uncopyable-history asset: a dated, source-linked change
 * ledger for one watched competitor, built from stored `landing_page_snapshot`
 * rows. Wrapping it in `Dataset` JSON-LD lets answer engines (GEO) address and
 * cite it as original data — the highest-leverage play in category-research
 * Bet 3 (issue #964).
 *
 * Every field mirrors what the page itself shows or stores — nothing invented:
 * - `datePublished`: the ISO timestamp of the FIRST stored snapshot (the day
 *   the ledger opened for this domain). Omitted when there are no entries.
 * - `dateModified`: the ISO timestamp of the LAST stored snapshot (the most
 *   recent capture the page renders). Omitted when there are no entries.
 * - `license`: the operating terms URL that governs reuse of the dataset —
 *   the same `/terms` the page footer links. Not a Creative Commons grant the
 *   terms do not make.
 * - `distribution`: a `DataDownload` pointing at the timeline's canonical URL
 *   as `text/html`, so an answer engine can fetch the citable surface itself.
 *
 * Emitted ONLY on indexable timeline pages (the route gates this on
 * `noindex === false`); a noindex shell never carries the Dataset.
 */
export function offerTimelineDatasetJsonLd(input: {
  brandName: string;
  domain: string;
  description: string;
  pathname: string;
  datePublished: string | null;
  dateModified: string | null;
}) {
  const dataset: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${input.brandName} offer timeline`,
    description: input.description,
    url: canonicalUrl(input.pathname),
    isAccessibleForFree: true,
    keywords: [
      input.domain,
      "offer timeline",
      "landing page changes",
      "competitor monitoring",
    ],
    creator: { "@type": "Organization", name: SITE_NAME, url: SITE_ORIGIN },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_ORIGIN },
    license: canonicalUrl("/terms"),
    distribution: {
      "@type": "DataDownload",
      name: `${input.brandName} offer timeline (HTML)`,
      contentUrl: canonicalUrl(input.pathname),
      encodingFormat: "text/html",
    },
  };
  if (input.datePublished) {
    dataset.datePublished = input.datePublished;
  }
  if (input.dateModified) {
    dataset.dateModified = input.dateModified;
  }
  return dataset;
}

/**
 * `hasPart` entry a brand page (`/ads/:domain`) embeds in its `WebPage`
 * JSON-LD to point answer engines at the per-competitor Offer Timeline
 * `Dataset`. Returned as the value for `WebPage.hasPart` — schema.org accepts
 * a single `CreativeWork`/`Dataset` there.
 *
 * Only emitted when the brand page is indexable AND a stored timeline exists
 * (the route already links the timeline section in that case). The URL is the
 * timeline's canonical URL; the type is `Dataset` so the relationship reads as
 * "this brand page has a citable dataset of its offer history".
 */
export function brandPageTimelineHasPart(input: {
  domain: string;
  brandName: string;
}) {
  const pathname = `/timeline/${input.domain}`;
  return {
    "@type": "Dataset",
    name: `${input.brandName} offer timeline`,
    url: canonicalUrl(pathname),
  } as const;
}

/**
 * Props for a JSON-LD <script> tag. Escapes `<` so page data can never break
 * out of the script element.
 */
export function jsonLdScriptProps(data: unknown) {
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(data).replace(/</g, "\\u003c"),
    },
  } as const;
}

export const SITEMAP_PATHS = [
  "/",
  "/search",
  "/compare",
  "/compare/magicbrief",
  "/compare/meta-ad-library",
  // /compare/visualping and /compare/foreplay are DROPPED from the sitemap
  // (issue #1481): each is a duplicate of its more specific sibling
  // (visualping-ad-library / foreplay-spyder) and canonicals to it. The
  // winner of each pair stays listed below.
  "/compare/visualping-ad-library",
  "/compare/spyland",
  "/compare/pulzifi",
  "/compare/foreplay-spyder",
  "/compare/panoramata",
  "/compare/adspyder",
  "/switch/magicbrief",
  "/switch/panoramata",
  "/switch/visualping",
  "/competitor-monitoring",
  "/sneaker-resale",
  "/de/sneaker-resale",
  "/ja/sneaker-resale",
  "/pt-br/sneaker-resale",
  // Locale-prefixed buyer-surface cluster (issue #1501). Each locale ships
  // the same set of buyer surfaces the EN locale serves; canonicals point
  // back at the EN version so duplicate content does not fragment search
  // ranking. Built from `BUYER_SURFACE_LOCALE_IDS` so a new locale added
  // there automatically widens the cluster without a separate edit. The
  // bare `/{locale}` index (e.g. `/de`) is intentionally NOT in this list:
  // it carries the same canonical as `/`, so listing it twice would emit a
  // duplicate `<loc>` for the same canonical target.
  ...BUYER_SURFACE_LOCALE_IDS.flatMap((locale) => [
    `/${locale}/pricing`,
    `/${locale}/help`,
    `/${locale}/docs`,
    `/${locale}/api/docs`,
    `/${locale}/status`,
    `/${locale}/changelog`,
    `/${locale}/trust`,
    `/${locale}/compare`,
    // BET 5 compare + BET 8 switch child routes (issue #1563): every
    // locale ships the same 11 child surfaces, with canonicals pointing
    // back at EN so the locale cluster cannot fragment search ranking.
    // The /compare/visualping and /compare/foreplay duplicates are out of
    // the child set (issue #1481) so no locale variant stays indexed.
    ...BUYER_SURFACE_CHILD_PATHS.map((child) => `/${locale}${child}`),
    // First-value search funnel + trust surfaces (issue 1578). Search is
    // the strongest first-value purchase-intent moment, so the localised
    // funnel must be crawlable and locale-targetable end to end.
    `/${locale}/search`,
    `/${locale}/competitor-monitoring`,
    `/${locale}/capture-rules`,
    `/${locale}/ad-aggression`,
  ]),
  // Canonical Ad Aggression Score formula page (issue #1263). The old
  // /methodology/ad-aggression-score path now 301-redirects here so any
  // indexed link keeps its equity; /proof is the legacy capture-rules
  // canonical kept out of the sitemap since it 301s to /capture-rules.
  "/capture-rules",
  "/ad-aggression",
  "/pricing",
  "/help",
  "/docs",
  "/api/docs",
  "/status",
  "/changelog",
  "/trust",
  "/privacy",
  "/terms",
] as const;

/**
 * Public action surfaces that carry `<meta name="robots" content="noindex">`
 * and must stay OUT of the sitemap. These are conversion/auth entries (signup,
 * login, magic-link, password-reset, billing portal), not reading surfaces —
 * indexing them would leak the auth surface, waste crawl budget, and let the
 * signup page compete with the homepage `/` for branded "five to nine"
 * queries. Each route's `meta` carries the noindex tag itself so a future
 * accidental re-add to the sitemap still produces a noindex page; this set is
 * the sitemap-side guard that the two never overlap.
 */
export const NOINDEX_ACTION_SURFACES = [
  "/auth/signup",
] as const;

/**
 * A sitemap `<url>` entry with optional metadata. `lastmod` is an ISO 8601
 * date (YYYY-MM-DD); `changefreq` and `priority` follow the sitemaps.org spec.
 * Only `lastmod` is actually honored by Google for crawl scheduling — the
 * other two are hints — but all three are emitted so crawlers that do read
 * them get an honest freshness and importance signal instead of nothing.
 */
export interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
  /** Number of non-demo ads backing an /ads/:domain entry; used by llms.txt. */
  adCount?: number;
  /** ISO timestamp of the underlying cache fetch; used by llms.txt. */
  fetchedAt?: string;
}

/**
 * Static funnel paths with honest changefreq/priority tiers. lastmod is
 * deliberately omitted on static paths — the build has no per-page content
 * timestamp, and inventing one would be a false freshness claim. Dynamic
 * /ads/:domain brand pages carry a real lastmod from their cache fetched_at.
 */
/**
 * Locale-prefixed buyer-surface cluster (issue #1501): each locale in
 * `BUYER_SURFACE_LOCALE_IDS` ships the same set of buyer surfaces the EN
 * locale serves, with the same priority/changefreq tier as the EN entry.
 * The bare `/<locale>` index intentionally carries no entry — its canonical
 * is `/` and listing it twice would emit a duplicate `<loc>` for the same
 * canonical target.
 */
const LOCALE_BUYER_SURFACE_PRIORITY: Record<string, { changefreq: string; priority: string }> =
  Object.fromEntries(
    BUYER_SURFACE_LOCALE_IDS.flatMap((locale) => [
      [`/${locale}/pricing`, { changefreq: "weekly", priority: "0.8" }],
      [`/${locale}/help`, { changefreq: "monthly", priority: "0.5" }],
      [`/${locale}/docs`, { changefreq: "monthly", priority: "0.5" }],
      [`/${locale}/api/docs`, { changefreq: "monthly", priority: "0.5" }],
      [`/${locale}/status`, { changefreq: "monthly", priority: "0.5" }],
      [`/${locale}/changelog`, { changefreq: "weekly", priority: "0.6" }],
      [`/${locale}/trust`, { changefreq: "yearly", priority: "0.3" }],
      [`/${locale}/compare`, { changefreq: "weekly", priority: "0.8" }],
      // Compare/switch child pages mirror the EN child tier (weekly, 0.7).
      ...BUYER_SURFACE_CHILD_PATHS.map((child) => [
        `/${locale}${child}`,
        { changefreq: "weekly", priority: "0.7" },
      ] as const),
      // First-value search funnel + supporting trust/proof surfaces (issue 1578).
      [`/${locale}/search`, { changefreq: "weekly", priority: "0.9" }],
      [`/${locale}/competitor-monitoring`, { changefreq: "weekly", priority: "0.8" }],
      [`/${locale}/capture-rules`, { changefreq: "monthly", priority: "0.5" }],
      [`/${locale}/ad-aggression`, { changefreq: "monthly", priority: "0.6" }],
    ]),
  );

const STATIC_CHANGEFREQ_PRIORITY: Record<string, { changefreq: string; priority: string }> = {
  "/": { changefreq: "daily", priority: "1.0" },
  "/search": { changefreq: "weekly", priority: "0.9" },
  "/competitor-monitoring": { changefreq: "weekly", priority: "0.8" },
  "/sneaker-resale": { changefreq: "weekly", priority: "0.8" },
  "/de/sneaker-resale": { changefreq: "weekly", priority: "0.8" },
  "/ja/sneaker-resale": { changefreq: "weekly", priority: "0.8" },
  "/pt-br/sneaker-resale": { changefreq: "weekly", priority: "0.8" },
  "/capture-rules": { changefreq: "monthly", priority: "0.5" },
  "/ad-aggression": { changefreq: "monthly", priority: "0.6" },
  "/pricing": { changefreq: "weekly", priority: "0.8" },
  "/compare": { changefreq: "weekly", priority: "0.8" },
  "/compare/magicbrief": { changefreq: "weekly", priority: "0.7" },
  "/compare/meta-ad-library": { changefreq: "weekly", priority: "0.7" },
  "/compare/visualping-ad-library": { changefreq: "weekly", priority: "0.7" },
  "/compare/spyland": { changefreq: "weekly", priority: "0.7" },
  "/compare/pulzifi": { changefreq: "weekly", priority: "0.7" },
  "/compare/foreplay-spyder": { changefreq: "weekly", priority: "0.7" },
  "/compare/panoramata": { changefreq: "weekly", priority: "0.7" },
  "/compare/adspyder": { changefreq: "weekly", priority: "0.7" },
  "/switch/magicbrief": { changefreq: "weekly", priority: "0.7" },
  "/switch/panoramata": { changefreq: "weekly", priority: "0.7" },
  "/switch/visualping": { changefreq: "weekly", priority: "0.7" },
  "/changelog": { changefreq: "weekly", priority: "0.6" },
  "/help": { changefreq: "monthly", priority: "0.5" },
  "/docs": { changefreq: "monthly", priority: "0.5" },
  "/api/docs": { changefreq: "monthly", priority: "0.5" },
  "/status": { changefreq: "monthly", priority: "0.5" },
  "/trust": { changefreq: "yearly", priority: "0.3" },
  "/privacy": { changefreq: "yearly", priority: "0.3" },
  "/terms": { changefreq: "yearly", priority: "0.3" },
  ...LOCALE_BUYER_SURFACE_PRIORITY,
};

export const SITEMAP_STATIC_ENTRIES: readonly SitemapEntry[] = SITEMAP_PATHS.map(
  (path) => ({
    path,
    ...STATIC_CHANGEFREQ_PRIORITY[path],
  }),
);

/**
 * Render a sitemap urlset from an ordered entry list. Single builder shared by
 * the static fallback (`SITEMAP_XML` below, used when there is no D1 / no
 * dynamic data) and the production sitemap, which appends dynamic /ads/:domain
 * brand-page entries — see `buildSitemapXml` in app/lib/sitemap.server.ts — so
 * the two can never drift.
 */
export function renderSitemapXml(entries: readonly SitemapEntry[]): string {
  const urlBlocks = entries.map((entry) => {
    const children = [`<loc>${canonicalUrl(entry.path)}</loc>`];
    if (entry.lastmod) {
      children.push(`<lastmod>${entry.lastmod}</lastmod>`);
    }
    if (entry.changefreq) {
      children.push(`<changefreq>${entry.changefreq}</changefreq>`);
    }
    if (entry.priority) {
      children.push(`<priority>${entry.priority}</priority>`);
    }
    return `  <url>${children.join("")}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlBlocks.join("\n")}
</urlset>
`;
}

// /ads/:domain BRAND PAGES ARE NOT IN THIS STATIC LIST — the set is dynamic.
// They are indexable by default (PUBLIC_BRAND_PAGES_INDEXABLE unset or "1";
// "0" is the emergency noindex brake), but the honest-shell, demo-sourced,
// and stale (>7 days) states always self-noindex — see
// app/routes/ads.$domain.tsx. The live sitemap (workers/app.ts) appends
// dynamic /ads/:domain entries generated from discovery_cache_entry rows that
// would render the indexable state (public_search route context, non-demo
// source, ads present, fetched_at within the 7-day freshness window) so we
// never sitemap a page that serves noindex or the "haven't checked recently"
// shell — crawl budget only goes to pages with real cached ads. The read is a
// bounded cache read at sitemap-render time (see app/lib/sitemap.server.ts);
// sitemap generation never triggers live discovery. This static XML is the
// no-DB fallback only.
const SITEMAP_XML = renderSitemapXml(SITEMAP_STATIC_ENTRIES);

// Keep /share/ CRAWLABLE on purpose: shared reports are de-indexed via the
// `x-robots-tag: noindex, nofollow` header set in workers/security-headers.ts,
// and crawlers can only see that header if robots.txt allows the fetch.
// Adding `Disallow: /share/` here would block the crawl and let Google index
// bare /share URLs from external links anyway ("indexed, though blocked by
// robots.txt" zombies). Do NOT "fix" this by disallowing /share/.
// "Disallow: /app/" alone does not cover the bare "/app" dashboard URL
// (trailing-slash prefix rules require the slash). "/app$" closes that for
// Google/Bing, which honor the $ end-of-URL anchor; crawlers that don't
// treat the line as a harmless literal, and "/app/" still covers subpaths.
// A bare "Disallow: /app" is NOT used because it would also block any future
// public path starting with "app" (e.g. /apply).
// AI crawler policy — decision recorded in docs/ai-crawler-policy.md
// ("answers yes, training no"): search and AI-answer/reference engines are
// welcome (they match the wildcard group below: Googlebot + AI Overviews,
// Bingbot, PerplexityBot, OAI-SearchBot, ChatGPT-User, Claude-By-Cloudflare,
// ...), while AI training/fine-tuning crawlers are denied (ai-train=no).
// The Cloudflare edge managed robots.txt is the SOLE source for the AI-training
// deny list; this file only carries the wildcard rules and Sitemap so the two
// blocks are not duplicated. Do not re-add an AI-training block here.
// Single source of truth for the AI training-crawler deny list (shared with
// the llms.txt "AI access" section in app/lib/public-markdown.ts so the two
// public surfaces can never drift apart). Policy: docs/ai-crawler-policy.md.
export const AI_TRAINING_CRAWLERS = [
  "Amazonbot",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "ClaudeBot",
  "CloudflareBrowserRenderingCrawler",
  "Google-Extended",
  "GPTBot",
  "meta-externalagent",
] as const;

// The AI-training deny list lives in the Cloudflare managed-robots zone config;
// it is intentionally NOT duplicated in this served robots.txt (issue #1459).
const ROBOTS_TXT = `# AI answer/reference engines are allowed by the wildcard group below.
# AI training/fine-tuning crawlers are denied at the zone by Cloudflare managed robots (ai-train=no).

User-agent: *
Allow: /api/docs
Disallow: /app$
Disallow: /app/
Disallow: /export/
Disallow: /api/
# /share/ stays crawlable so crawlers can see its noindex header.
Allow: /
Sitemap: ${canonicalUrl("/sitemap.xml")}
`;

const SOCIAL_CARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">Five to Nine</title>
  <desc id="desc">Competitor offer monitoring workspace preview for Five to Nine.</desc>
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#52c9df"/>
      <stop offset="0.42" stop-color="#7f5cff"/>
      <stop offset="0.72" stop-color="#ff5f74"/>
      <stop offset="1" stop-color="#f9c37b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <path d="M0 420 L1200 300 L1200 630 L0 630 Z" fill="#fff"/>
  <g opacity="0.23" stroke="#fff" stroke-width="1">
    <path d="M0 96H1200"/><path d="M0 192H1200"/><path d="M0 288H1200"/><path d="M0 384H1200"/>
    <path d="M120 0V630"/><path d="M240 0V630"/><path d="M360 0V630"/><path d="M480 0V630"/>
    <path d="M600 0V630"/><path d="M720 0V630"/><path d="M840 0V630"/><path d="M960 0V630"/><path d="M1080 0V630"/>
  </g>
  <g font-family="Inter, Arial, sans-serif" font-weight="800">
    <text x="86" y="92" fill="#fff" font-size="42">Five to Nine</text>
    <text x="86" y="222" fill="#07111a" font-size="78">Know when competitors</text>
    <text x="86" y="318" fill="#07111a" font-size="78">change the offer.</text>
  <text x="88" y="418" fill="#344052" font-size="34" font-weight="600">Watch ads and landing pages with sources.</text>
    <rect x="780" y="118" width="340" height="330" rx="34" fill="#ffffff" opacity="0.9"/>
    <text x="818" y="180" fill="#07111a" font-size="28">Competitor changes</text>
    <path d="M820 260 L884 230 L944 246 L1014 186 L1080 206" fill="none" stroke="#635bff" stroke-width="7" stroke-linecap="round"/>
    <text x="818" y="340" fill="#425466" font-size="26" font-weight="700">Offer changed</text>
    <text x="818" y="386" fill="#425466" font-size="26" font-weight="700">Landing page saved</text>
    <text x="818" y="432" fill="#425466" font-size="26" font-weight="700">Saved evidence</text>
  </g>
</svg>
`;

export function publicSeoFileForPathname(pathname: string) {
  if (pathname === "/robots.txt") {
    return {
      body: ROBOTS_TXT,
      contentType: "text/plain; charset=utf-8",
      cacheControl: "public, max-age=3600",
    };
  }

  if (pathname === "/sitemap.xml") {
    return {
      body: SITEMAP_XML,
      contentType: "application/xml; charset=utf-8",
      cacheControl: "public, max-age=3600",
    };
  }

  if (pathname === LEGACY_SOCIAL_CARD_PATH) {
    return {
      body: SOCIAL_CARD_SVG,
      contentType: "image/svg+xml; charset=utf-8",
      cacheControl: "public, max-age=86400",
    };
  }

  return null;
}
