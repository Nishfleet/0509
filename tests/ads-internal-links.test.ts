import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  displayNameFromDomain,
  indexableAdsLinkFromPath,
  pickFeaturedAdsInternalLink,
  resolveSearchBrandPageDomain,
  type IndexableAdsLink,
} from "~/lib/ads-internal-links";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const nykaa: IndexableAdsLink = {
  domain: "nykaa.com",
  path: "/ads/nykaa.com",
  name: "Nykaa",
};
const glossier: IndexableAdsLink = {
  domain: "glossier.com",
  path: "/ads/glossier.com",
  name: "Glossier",
};

function mockReactRouter(loaderData: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useLocation: vi.fn().mockReturnValue({ pathname: "/competitor-monitoring" }),
      useRouteLoaderData: vi.fn().mockReturnValue({
        pricingPlans: [],
        usageBundles: [],
        session: null,
      }),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("indexable ads link helpers", () => {
  it("accepts only /ads/:domain paths", () => {
    expect(indexableAdsLinkFromPath("/ads/nykaa.com")).toEqual(nykaa);
    expect(indexableAdsLinkFromPath("/ads/nykaa.com/extra")).toBeNull();
    expect(indexableAdsLinkFromPath("/search")).toBeNull();
    expect(indexableAdsLinkFromPath("/ads/")).toBeNull();
  });

  it("uses public brand names for stylised registrable domains", () => {
    expect(displayNameFromDomain("hm.com")).toBe("H&M");
    expect(displayNameFromDomain("ouraring.com")).toBe("Oura");
    expect(displayNameFromDomain("bombayshavingcompany.com")).toBe("Bombay Shaving Company");
    expect(displayNameFromDomain("mcaffeine.com")).toBe("mCaffeine");
    expect(displayNameFromDomain("sugarcosmetics.com")).toBe("Sugar Cosmetics");
    expect(displayNameFromDomain("asos.com")).toBe("ASOS");
    expect(displayNameFromDomain("hubspot.com")).toBe("HubSpot");
    expect(displayNameFromDomain("ridgewallet.com")).toBe("Ridge Wallet");
    // Simple one-word host labels keep the existing first-label title case.
    expect(displayNameFromDomain("nykaa.com")).toBe("Nykaa");
    expect(indexableAdsLinkFromPath("/ads/hm.com")).toEqual({
      domain: "hm.com",
      path: "/ads/hm.com",
      name: "H&M",
    });
  });

  it("prefers the featured domain when it is in the indexable set", () => {
    expect(pickFeaturedAdsInternalLink([glossier, nykaa], "nykaa.com")).toEqual(nykaa);
    expect(pickFeaturedAdsInternalLink([glossier], "nykaa.com")).toEqual(glossier);
    expect(pickFeaturedAdsInternalLink([], "nykaa.com")).toBeNull();
  });

  it("resolves a search brand domain from an explicit domain search", () => {
    expect(
      resolveSearchBrandPageDomain({
        displayDomain: "Nykaa.com",
        ads: [
          { domainMatch: { matchedDomain: "nykaa.com" } },
          { domainMatch: { matchedDomain: "unrelated.net" } },
        ],
      }),
    ).toBe("nykaa.com");
    expect(
      resolveSearchBrandPageDomain({
        displayDomain: "www.Nykaa.com",
        ads: [],
      }),
    ).toBe("nykaa.com");
  });

  it("falls back to the matched domain of result rows for a bare keyword", () => {
    expect(
      resolveSearchBrandPageDomain({
        displayDomain: null,
        ads: [
          { domainMatch: { matchedDomain: null } },
          { domainMatch: { matchedDomain: "Glossier.com" } },
        ],
      }),
    ).toBe("glossier.com");
  });

  it("never invents a brand domain when nothing is established", () => {
    expect(
      resolveSearchBrandPageDomain({
        displayDomain: null,
        ads: [{ domainMatch: { matchedDomain: null } }],
      }),
    ).toBeNull();
    expect(
      resolveSearchBrandPageDomain({
        displayDomain: null,
        ads: [],
      }),
    ).toBeNull();
    expect(
      resolveSearchBrandPageDomain({
        displayDomain: "   ",
        ads: [{ domainMatch: { matchedDomain: null } }],
      }),
    ).toBeNull();
  });
});

describe("internal /ads/:domain links on public funnel pages", () => {
  it("renders an indexable /ads/:domain anchor on the homepage", async () => {
    mockReactRouter({
      pricingPreview: { available: false },
      commercialLaunch: {
        scoutSaleOpen: true,
        starterSaleOpen: true,
        agencySaleOpen: false,
      },
      proofBrief: null,
      indexableAdsLinks: [nykaa, glossier],
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));

    expect(markup).toContain('href="/ads/nykaa.com"');
  });

  it("renders Browse tracked competitors links on /competitor-monitoring", async () => {
    mockReactRouter({
      proofBrief: null,
      indexableAdsLinks: [nykaa, glossier],
    });

    const { default: CompetitorMonitoringRoute } = await import("~/routes/competitor-monitoring");
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringRoute));

    expect(markup).toContain("Browse tracked competitors");
    expect(markup).toContain('href="/ads/nykaa.com"');
    expect(markup).toContain('href="/ads/glossier.com"');
  });

  it("does not invent /ads links on /competitor-monitoring when none are indexable", async () => {
    mockReactRouter({
      proofBrief: null,
      indexableAdsLinks: [],
    });

    const { default: CompetitorMonitoringRoute } = await import("~/routes/competitor-monitoring");
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringRoute));

    expect(markup).not.toContain("Browse tracked competitors");
    expect(markup).not.toMatch(/href="\/ads\/[^"]+"/);
  });

  it("renders a brand ads link on a /compare route when an indexable page exists", async () => {
    mockReactRouter({ featuredAdsLink: nykaa });

    const { default: CompareVisualpingRoute } = await import("~/routes/compare.visualping");
    const markup = renderToStaticMarkup(createElement(CompareVisualpingRoute));

    expect(markup).toContain('href="/ads/nykaa.com"');
    expect(markup).toMatch(/See Nykaa(?:'|&#x27;|&apos;)s ads on Five to Nine/);
  });

  it("falls back to /search on a /compare route when no indexable brand page exists", async () => {
    mockReactRouter({ featuredAdsLink: null });

    const { default: CompareVisualpingRoute } = await import("~/routes/compare.visualping");
    const markup = renderToStaticMarkup(createElement(CompareVisualpingRoute));

    expect(markup).not.toMatch(/href="\/ads\/[^"]+"/);
    expect(markup).toContain("See competitor ads on Five to Nine");
    expect(markup).toContain('href="/search"');
  });
});

describe("public funnel loaders reuse the sitemap indexability filter", () => {
  const commercialLaunch = {
    scoutSaleOpen: true,
    starterSaleOpen: true,
    agencySaleOpen: false,
  };

  beforeEach(() => {
    vi.doMock("~/lib/dodo-pricing.server", () => ({
      previewDodo0509PlanPrices: vi.fn().mockResolvedValue({ available: false }),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({
      publicCommercialLaunchSummary: vi.fn(() => commercialLaunch),
    }));
    vi.doMock("~/lib/public-proof.server", () => ({
      loadPublicProofBrief: vi.fn().mockResolvedValue(null),
      PUBLIC_PROOF_FEATURED_WEBSITE: "nykaa.com",
    }));
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nykaa.com" },
        { path: "/ads/glossier.com" },
        { path: "/ads/nykaa.com/extra" },
      ]),
    }));
  });

  it("puts only bare /ads/:domain sitemap paths on the homepage loader", async () => {
    const { loader } = await import("~/routes/marketing");
    const result = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/"),
    } as never);

    expect(result).toEqual({
      pricingPreview: { available: false },
      commercialLaunch,
      proofBrief: null,
      indexableAdsLinks: [nykaa, glossier],
    });
  });

  it("puts the same indexable set on /competitor-monitoring", async () => {
    const { loader } = await import("~/routes/competitor-monitoring");
    const result = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/competitor-monitoring"),
    } as never);

    expect(result).toEqual({
      proofBrief: null,
      indexableAdsLinks: [nykaa, glossier],
    });
  });
});

describe("loadSneakerResaleAdsInternalLinks", () => {
  beforeEach(() => {
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nike.com" },
        { path: "/ads/stockx.com" },
        { path: "/ads/nykaa.com" },
        { path: "/ads/nike.com/extra" },
      ]),
    }));
  });

  // Issue #1547: the /sneaker-resale cross-link section must list exactly the
  // cluster's live pages — seed-list members that are indexable (nike.com,
  // stockx.com) and nothing else (nykaa.com is indexable but not in the
  // cluster; the non-bare path is dropped by the shared filter).
  it("keeps only indexable pages whose domain is in the seed list", async () => {
    vi.resetModules();
    const { loadSneakerResaleAdsInternalLinks } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await loadSneakerResaleAdsInternalLinks({} as never)).toEqual([
      { domain: "nike.com", path: "/ads/nike.com", name: "Nike" },
      { domain: "stockx.com", path: "/ads/stockx.com", name: "StockX" },
    ]);
  });
});

describe("resolveIndexableBrandPageLinkForDomain", () => {
  beforeEach(() => {
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nykaa.com" },
        { path: "/ads/glossier.com" },
      ]),
    }));
  });

  it("resolves a search-derived domain to its indexable brand-page link", async () => {
    vi.resetModules();
    const { resolveIndexableBrandPageLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await resolveIndexableBrandPageLinkForDomain({}, "Nykaa.com")).toEqual({
      domain: "nykaa.com",
      path: "/ads/nykaa.com",
      name: "Nykaa",
    });
  });

  it("returns null when the domain has no indexable brand page", async () => {
    vi.resetModules();
    const { resolveIndexableBrandPageLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await resolveIndexableBrandPageLinkForDomain({}, "missingbrand.com")).toBeNull();
  });

  it("returns null for an absent or blank domain without querying", async () => {
    vi.resetModules();
    const { resolveIndexableBrandPageLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await resolveIndexableBrandPageLinkForDomain({}, null)).toBeNull();
    expect(await resolveIndexableBrandPageLinkForDomain({}, undefined)).toBeNull();
    expect(await resolveIndexableBrandPageLinkForDomain({}, "   ")).toBeNull();
  });
});
