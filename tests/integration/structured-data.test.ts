import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyDomainArchive } from "~/lib/archive";
import { pricingPlans, usageBundles } from "~/lib/pricing";
import type { AdRecord } from "~/lib/types";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { OfferTimelineLoaderData } from "~/routes/timeline.$domain";

/**
 * Issue #2855 — every indexable public marketing page must serve valid
 * JSON-LD structured data appropriate to its type. The suite renders each
 * key route's served markup (the same renderToStaticMarkup pattern as
 * ads-domain-page.test.ts and compare-structured-data.test.ts — the node
 * project cannot fetch through workerd, and the rendered <script
 * type="application/ld+json"> blocks ARE what the route serves), parses
 * every ld+json block, and asserts the expected @type set per surface:
 *
 *   /                          Organization + WebSite (+ FAQPage)
 *   /pricing                   WebPage + FAQPage + @graph of Product/Offer
 *   /competitor-monitoring     WebPage + Service + FAQPage + BreadcrumbList
 *   /guides/*                  WebPage + Article + FAQPage
 *   /brands                    WebPage + ItemList
 *   /compare                   WebPage + ItemList
 *   /compare/*                 WebPage + BreadcrumbList (+ FAQPage)
 *   /ads/:domain               WebPage + Service + BreadcrumbList + FAQPage
 *   /timeline/:domain          WebPage + BreadcrumbList + Dataset
 */

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

let currentLoaderData: unknown;
let currentRootData: unknown;
let currentLocation: { pathname: string; search: string; hash: string; state: null; key: string };

beforeEach(() => {
  vi.resetModules();
  currentLoaderData = undefined;
  currentRootData = {
    session: null,
    pricingPlans: pricingPlans(),
    usageBundles: usageBundles(),
  };
  currentLocation = { pathname: "/", search: "", hash: "", state: null, key: "test" };
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    const MockForm = ({ children, ...props }: MockFormProps) =>
      React.createElement("form", props, children);
    const MockLink = ({ children, to, ...props }: MockLinkProps) =>
      React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children);
    return {
      ...actual,
      Form: MockForm,
      Link: MockLink,
      NavLink: MockLink,
      Outlet: () => null,
      useActionData: () => undefined,
      useFetcher: () => ({
        state: "idle",
        data: undefined,
        Form: MockForm,
        submit: vi.fn(),
        load: vi.fn(),
      }),
      useFetchers: () => [],
      useLoaderData: () => currentLoaderData,
      useLocation: () => currentLocation,
      useMatches: () => [],
      useNavigate: () => vi.fn(),
      useNavigation: () => ({ state: "idle" }),
      useParams: () => ({}),
      useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: () => currentRootData,
      useSearchParams: () => [new URLSearchParams(), vi.fn()],
      useSubmit: () => vi.fn(),
    };
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return matches.map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
}

async function ldBlocks(
  routeId: string,
  options: { loaderData?: unknown; rootData?: unknown; pathname?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  currentLoaderData = options.loaderData;
  if (options.rootData !== undefined) currentRootData = options.rootData;
  if (options.pathname !== undefined) {
    currentLocation = { ...currentLocation, pathname: options.pathname };
  }
  const routeModule = (await import(`~/routes/${routeId}`)) as { default: () => ReactNode };
  return parseLdJsonBlocks(renderToStaticMarkup(createElement(routeModule.default)));
}

/** Every @type across the parsed blocks, including @graph members. */
function ldTypes(blocks: Array<Record<string, unknown>>): string[] {
  const types = new Set<string>();
  for (const block of blocks) {
    if (typeof block["@type"] === "string") types.add(block["@type"]);
    const graph = block["@graph"];
    if (Array.isArray(graph)) {
      for (const node of graph) {
        if (node && typeof node === "object" && typeof node["@type"] === "string") {
          types.add(node["@type"] as string);
        }
      }
    }
  }
  return [...types].sort();
}

function expectSchemaOrg(blocks: Array<Record<string, unknown>>, routeId: string) {
  expect(blocks.length, `${routeId} serves no application/ld+json blocks`).toBeGreaterThanOrEqual(1);
  for (const block of blocks) {
    expect(block["@context"], `${routeId} ld+json block missing @context`).toBe("https://schema.org");
  }
}

const commercialLaunch = { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false };

const marketingLoaderData = {
  pricingPreview: { available: false },
  commercialLaunch,
  changeMark: null,
  proofBrief: null,
  featuredDomain: "nike.com",
  indexableAdsLinks: [],
};

const pricingLoaderData = {
  pricingPreview: { available: false },
  commercialLaunch,
};

const competitorMonitoringLoaderData = { proofBrief: null, indexableAdsLinks: [] };

const brandsLoaderData = {
  groups: [
    {
      category: "Footwear",
      items: [
        { domain: "nike.com", path: "/ads/nike.com", name: "Nike", timelineIndexable: true },
        { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas", timelineIndexable: false },
      ],
    },
  ],
  allCount: 2,
  categoryLinks: [],
};

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: overrides.metaAdId ?? "ad-1",
    advertiser: "Nike",
    body: "Run through summer.",
    previewHeadline: "Run through summer.",
    previewSubhead: "",
    hook: "Shop Now",
    offer: "",
    cta: "Shop Now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nike.com/launch",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

// Same indexable brand-page shape as ads-domain-page.test.ts: hasCachedAds +
// verifiedLinkCount > 0 so the BreadcrumbList / WebPage / Service / FAQPage
// quartet all emit.
const adsLoaderData: BrandPageLoaderData = {
  domain: "nike.com",
  brandName: "Nike",
  hasCachedAds: true,
  ads: [ad({ metaAdId: "ad-1" })],
  verifiedLinkedIds: ["ad-1"],
  checkedAgo: "about 2 hours ago",
  lastCheckedAt: "2026-09-10T10:00:00.000Z",
  freshForLiveClaim: false,
  brandOwnedAdCount: 1,
  verifiedLinkCount: 1,
  unverifiedMatchCount: 0,
  partnerCampaignAdIds: [],
  teaser: null,
  aggression: null,
  observationDays: null,
  changeEvents: [],
  offerTimelineEntries: [
    {
      id: "snap-1",
      capturedAt: "2026-08-01T00:00:00.000Z",
      dateLabel: "Aug 1",
      canonicalUrl: "https://www.nike.com",
      headline: "Just do it",
      ctaText: "Shop",
      priceText: null,
      formPresent: false,
      screenshotHref: null,
      pageTextHref: null,
      captureMethod: "landing_page_fetch",
      evidenceNote: null,
      transition: null,
      suppressedReason: null,
      runExtentLabel: null,
    },
  ],
  timelineIndexable: true,
  adLibraryCountry: "India",
  noindex: false,
  relatedBrands: [],
  canonicalPath: "/ads/nike.com",
  captureFailuresSummary: null,
  recentWatchChanges: [],
  sourceSnapshots: [],
};

const timelineLoaderData: OfferTimelineLoaderData = {
  domain: "nike.com",
  brandName: "Nike",
  canonicalPath: "/timeline/nike.com",
  sharePath: "/timeline/nike.com",
  shareUrl: "https://0509.io/timeline/nike.com",
  shareEnabled: true,
  asOf: null,
  asOfState: null,
  entries: [
    {
      id: "snap-1",
      capturedAt: "2026-08-01T00:00:00.000Z",
      dateLabel: "Aug 1",
      canonicalUrl: "https://www.nike.com",
      headline: "Just do it",
      ctaText: "Shop",
      priceText: null,
      formPresent: false,
      screenshotHref: null,
      pageTextHref: null,
      captureMethod: "landing_page_fetch",
      evidenceNote: null,
      transition: null,
      suppressedReason: null,
      runExtentLabel: null,
    },
    {
      id: "snap-2",
      capturedAt: "2026-09-01T00:00:00.000Z",
      dateLabel: "Sep 1",
      canonicalUrl: "https://www.nike.com",
      headline: "Just do it — new drop",
      ctaText: "Shop",
      priceText: null,
      formPresent: false,
      screenshotHref: null,
      pageTextHref: null,
      captureMethod: "landing_page_fetch",
      evidenceNote: null,
      transition: null,
      suppressedReason: null,
      runExtentLabel: null,
    },
  ],
  archive: emptyDomainArchive("nike.com", new Date("2026-09-11T00:00:00.000Z")),
  sourceEvents: [],
  noindex: false,
  collecting: false,
};

describe("public marketing pages serve schema.org JSON-LD (issue #2855)", () => {
  it("/ serves Organization + WebSite (+ FAQPage)", async () => {
    const blocks = await ldBlocks("marketing", { loaderData: marketingLoaderData });
    expectSchemaOrg(blocks, "/");
    expect(ldTypes(blocks)).toEqual(
      expect.arrayContaining(["Organization", "WebSite", "FAQPage"]),
    );
  });

  it("/pricing serves WebPage + FAQPage + a @graph of Product/Offer", async () => {
    const blocks = await ldBlocks("pricing", { loaderData: pricingLoaderData });
    expectSchemaOrg(blocks, "/pricing");
    expect(ldTypes(blocks)).toEqual(
      expect.arrayContaining(["WebPage", "FAQPage", "Product"]),
    );
    const graphBlock = blocks.find((block) => Array.isArray(block["@graph"]));
    expect(graphBlock, "/pricing serves a @graph block").toBeTruthy();
    const products = (graphBlock?.["@graph"] as Array<Record<string, unknown>>).filter(
      (node) => node["@type"] === "Product",
    );
    expect(products.length).toBeGreaterThanOrEqual(7);
    for (const product of products) {
      const offers = product.offers as Record<string, unknown> | undefined;
      expect(offers?.["@type"]).toBe("Offer");
    }
  });

  it("/competitor-monitoring serves WebPage + Service + FAQPage + BreadcrumbList", async () => {
    const blocks = await ldBlocks("competitor-monitoring", {
      loaderData: competitorMonitoringLoaderData,
      pathname: "/competitor-monitoring",
    });
    expectSchemaOrg(blocks, "/competitor-monitoring");
    expect(ldTypes(blocks)).toEqual(
      expect.arrayContaining(["WebPage", "Service", "FAQPage", "BreadcrumbList"]),
    );
  });

  it("/guides/how-to-track-competitor-ads serves WebPage + Article + FAQPage", async () => {
    const blocks = await ldBlocks("guides.how-to-track-competitor-ads");
    expectSchemaOrg(blocks, "/guides/how-to-track-competitor-ads");
    expect(ldTypes(blocks)).toEqual(
      expect.arrayContaining(["WebPage", "Article", "FAQPage"]),
    );
    const article = blocks.find((block) => block["@type"] === "Article");
    expect(article?.headline).toBe(
      "How to track competitor ads: the free way, the DIY way, and where both break.",
    );
    expect(article?.mainEntityOfPage).toEqual({
      "@type": "WebPage",
      "@id": "https://0509.io/guides/how-to-track-competitor-ads",
    });
  });

  it("/brands serves WebPage + ItemList", async () => {
    const blocks = await ldBlocks("brands", { loaderData: brandsLoaderData });
    expectSchemaOrg(blocks, "/brands");
    expect(ldTypes(blocks)).toEqual(expect.arrayContaining(["WebPage", "ItemList"]));
    const itemList = blocks.find((block) => block["@type"] === "ItemList");
    const elements = itemList?.itemListElement as Array<Record<string, unknown>>;
    expect(elements.map((el) => el.item)).toEqual([
      "https://0509.io/ads/nike.com",
      "https://0509.io/ads/adidas.com",
    ]);
  });

  it("/compare serves WebPage + ItemList", async () => {
    const blocks = await ldBlocks("compare");
    expectSchemaOrg(blocks, "/compare");
    expect(ldTypes(blocks)).toEqual(expect.arrayContaining(["WebPage", "ItemList"]));
  });

  it.each(["compare.pulzifi", "compare.spyland", "compare.meta-ad-library", "compare.adspy"])(
    "%s serves WebPage + BreadcrumbList",
    async (routeId) => {
      const blocks = await ldBlocks(routeId);
      expectSchemaOrg(blocks, routeId);
      expect(ldTypes(blocks)).toEqual(expect.arrayContaining(["WebPage", "BreadcrumbList"]));
    },
  );

  it("/ads/:domain serves WebPage + Service + BreadcrumbList + FAQPage", async () => {
    const blocks = await ldBlocks("ads.$domain", { loaderData: adsLoaderData });
    expectSchemaOrg(blocks, "/ads/:domain");
    expect(ldTypes(blocks)).toEqual(
      expect.arrayContaining(["WebPage", "Service", "BreadcrumbList", "FAQPage"]),
    );
    const service = blocks.find((block) => block["@type"] === "Service");
    expect(service?.name).toBe("Track nike.com");
    expect(service?.provider).toEqual({
      "@type": "Organization",
      name: "Five to Nine",
      url: "https://0509.io",
    });
  });

  it("/timeline/:domain serves WebPage + BreadcrumbList + Dataset", async () => {
    const blocks = await ldBlocks("timeline.$domain", { loaderData: timelineLoaderData });
    expectSchemaOrg(blocks, "/timeline/:domain");
    expect(ldTypes(blocks)).toEqual(
      expect.arrayContaining(["WebPage", "BreadcrumbList", "Dataset"]),
    );
    const dataset = blocks.find((block) => block["@type"] === "Dataset");
    expect(dataset?.datePublished).toBe("2026-08-01T00:00:00.000Z");
    expect(dataset?.dateModified).toBe("2026-09-01T00:00:00.000Z");
  });
});
