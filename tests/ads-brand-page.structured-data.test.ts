import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { AdRecord } from "~/lib/types";

let currentData: BrandPageLoaderData;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => currentData,
      useRouteLoaderData: () => undefined,
      Link: ({
        children,
        to,
        ...props
      }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
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

async function render(data: BrandPageLoaderData): Promise<string> {
  currentData = data;
  const { default: BrandAdsRoute } = await import("~/routes/ads.$domain");
  return renderToStaticMarkup(createElement(BrandAdsRoute));
}

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: overrides.metaAdId ?? "ad-1",
    advertiser: "Nike",
    body: "Run through summer.",
    previewHeadline: "Run through summer with gear that can take the heat.",
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

function cachedIndexable(overrides: Partial<BrandPageLoaderData> = {}): BrandPageLoaderData {
  const ads = Array.from({ length: 6 }, (_v, i) => ad({ metaAdId: `ad-${i}` }));
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads,
    verifiedLinkedAds: ads,
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-08-09T10:00:00.000Z",
    freshForLiveClaim: false,
    brandOwnedAdCount: 6,
    verifiedLinkCount: 6,
    unverifiedMatchCount: 0,
    teaser: {
      totalCount: 6,
      activeCount: 6,
      longestRunningDays: 126,
      longestRunningHook: "Charge shin guards",
      formats: ["image", "video", "carousel"],
    },
    aggression: {
      score: 78,
      components: { velocity: 22, testing: 19, freshness: 20, persistence: 17 },
      bandId: "all_out",
      bandLabel: "All-out",
      bandInterpretation: "Running an all-out launch and testing push.",
      formulaVersion: 1,
      windowDays: 21,
      adsPerWeek: 6,
      adCount: 6,
      activeCount: 6,
    },
    changeEvents: [],
    observationDays: null,
    adLibraryCountry: "India",
    noindex: false,
    canonicalPath: "/ads/nike.com",
    offerTimelineEntries: [],
    captureFailuresSummary: null,
    ...overrides,
  };
}

describe("adsPageServiceJsonLd", () => {
  it("describes the per-competitor watch offer with brand, URL, and Five to Nine as provider", async () => {
    const { adsPageServiceJsonLd } = await import("~/lib/seo");
    const block = JSON.parse(
      JSON.stringify(
        adsPageServiceJsonLd({
          brandName: "Nike",
          domain: "nike.com",
          description:
            "See 6 Meta ads from Nike (nike.com), from a public check of the India Ad Library about 2 hours ago. Get an email when their ads or offer change.",
          pathname: "/ads/nike.com",
        }),
      ),
    );

    expect(block["@context"]).toBe("https://schema.org");
    expect(block["@type"]).toBe("Service");
    expect(block.name).toBe("Watch nike.com");
    expect(block.url).toBe("https://0509.io/ads/nike.com");
    expect(block.provider).toEqual({
      "@type": "Organization",
      name: "Five to Nine",
      url: "https://0509.io",
    });
    expect(block.about).toEqual({ "@type": "Organization", name: "Nike" });
    expect(JSON.stringify(block)).not.toMatch(/price|aggregateRating|offers/i);
    expect(JSON.stringify(block)).not.toMatch(/[$₹€£]\s?\d/);
  });
});

describe("/ads/:domain JSON-LD", () => {
  it("emits BreadcrumbList, FAQPage, Service and WebPage on a cached, indexable brand page", async () => {
    const data = cachedIndexable();
    const markup = await render(data);

    expect(markup).toContain("Tracking nike.com");
    expect(markup).toContain("Watch nike.com →");
    expect(markup).toContain("Common questions about Nike&#x27;s ads");
    expect(markup).toContain("How is Nike's Ad Aggression Score calculated?");

    const blocks = parseLdJsonBlocks(markup);
    expect(blocks).toHaveLength(4);

    const breadcrumbs = blocks.filter((block) => block["@type"] === "BreadcrumbList");
    const webPages = blocks.filter((block) => block["@type"] === "WebPage");
    const services = blocks.filter((block) => block["@type"] === "Service");
    const faqPages = blocks.filter((block) => block["@type"] === "FAQPage");
    expect(breadcrumbs).toHaveLength(1);
    expect(webPages).toHaveLength(1);
    expect(services).toHaveLength(1);
    expect(faqPages).toHaveLength(1);

    const breadcrumb = breadcrumbs[0] ?? {};
    expect(breadcrumb["@context"]).toBe("https://schema.org");
    const items = (breadcrumb.itemListElement as Array<Record<string, unknown>>) ?? [];
    expect(items.map((i) => i["@type"])).toEqual(["ListItem", "ListItem", "ListItem"]);
    expect(items.map((i) => i["position"])).toEqual([1, 2, 3]);
    expect(items.map((i) => i["name"])).toEqual(["Five to Nine", "Ads", "Nike"]);
    expect(items.map((i) => i["item"])).toEqual([
      "https://0509.io/",
      "https://0509.io/search",
      "https://0509.io/ads/nike.com",
    ]);
    // The visible breadcrumb nav matches the JSON-LD trail.
    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain("Five to Nine");
    expect(markup).toContain('href="/search"');
    expect(markup).toMatch(/aria-current="page">Nike</);

    const service = services[0] ?? {};
    expect(service["@context"]).toBe("https://schema.org");
    expect(service.name).toBe("Watch nike.com");
    expect(service.url).toBe("https://0509.io/ads/nike.com");
    expect(service.provider).toEqual({
      "@type": "Organization",
      name: "Five to Nine",
      url: "https://0509.io",
    });
    expect(service.about).toEqual({ "@type": "Organization", name: "Nike" });
    expect(markup).toContain("Nike");
    expect(service.description).toBe(
      "See 6 Meta ads from Nike (nike.com), from a public check of the India Ad Library about 2 hours ago. Get an email when their ads or offer change.",
    );

    const faq = faqPages[0] as Record<string, unknown>;
    const mainEntity = (faq.mainEntity as Array<Record<string, unknown>>) ?? [];
    expect(mainEntity.length).toBeGreaterThanOrEqual(3);
    expect(mainEntity.every((entry) => entry["@type"] === "Question")).toBe(true);
    const questions = mainEntity.map((entry) => entry.name as string);
    expect(questions).toContain("How is Nike's Ad Aggression Score calculated?");
    expect(questions).toContain("How often are Nike's ads checked?");
    expect(questions).toContain('What does "verified" mean on these ads?');
    expect(questions).toContain("Can I get an email when Nike's ads or offer change?");

    const serialized = JSON.stringify(blocks);
    expect(serialized).not.toMatch(/aggregateRating|reviewCount|ratingValue/i);
    expect(serialized).not.toContain('"@type":"Offer"');
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
  }, 20_000);

  it("omits Service and WebPage JSON-LD on the noindex honest shell", async () => {
    const markup = await render(
      cachedIndexable({
        hasCachedAds: false,
        ads: [],
        verifiedLinkedAds: [],
        checkedAgo: null,
        lastCheckedAt: null,
        teaser: null,
        aggression: null,
        changeEvents: [],
        brandOwnedAdCount: 0,
        verifiedLinkCount: 0,
        unverifiedMatchCount: 0,
        noindex: true,
      }),
    );

    expect(parseLdJsonBlocks(markup)).toHaveLength(0);
    expect(markup).not.toContain("application/ld+json");
    expect(markup).not.toContain('"@type":"Service"');
    expect(markup).not.toContain("Common questions about Nike&#x27;s ads");
  }, 20_000);

  it("omits Service and FAQPage JSON-LD when the emergency noindex brake is on", async () => {
    const markup = await render(cachedIndexable({ noindex: true }));

    expect(parseLdJsonBlocks(markup)).toHaveLength(0);
    expect(markup).not.toContain("application/ld+json");
    expect(markup).not.toContain('"@type":"Service"');
    expect(markup).not.toContain('"@type":"FAQPage"');
    expect(markup).not.toContain("Common questions about Nike&#x27;s ads");
  }, 20_000);
});
