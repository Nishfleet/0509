import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  displayNameFromDomain,
  indexableAdsLinkFromPath,
  pickFeaturedAdsInternalLink,
  pickRelatedBrandLinks,
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
  // vi.resetModules() clears the module cache but NOT the vi.doMock registry,
  // so a doMock from one test leaks into the next and non-deterministically
  // overrides (or fails to override) the next test's own doMock — the same
  // module then resolves to the wrong factory and the open-ccTLD fallback
  // tests flake (fleet-ops FleetMainRed 2026-09-06). Unregister every module
  // this file doMocks so each test starts from a clean mock registry.
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/dodo-pricing.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/commercial-launch-gate.server");
  vi.doUnmock("~/lib/public-proof.server");
  vi.doUnmock("~/lib/sitemap.server");
  vi.resetModules();
});

/**
 * Issue #2048: every /ads/:domain page must render a "More tracked brands"
 * cluster of >=10 sibling /ads links drawn from the SAME indexable cohort the
 * sitemap uses — a connected crawlable brand graph, not isolated pages. The
 * loader (loadIndexableAdsInternalLinks) feeds pickRelatedBrandLinks from
 * the sitemap indexability filter, so the cluster can never contain a
 * cache-miss page that 301s to /search.
 */
describe("/ads/:domain 'More tracked brands' cluster (issue #2048)", () => {
  const cohort: IndexableAdsLink[] = Array.from({ length: 20 }, (_v, i) => {
    const domain = i === 0 ? "nike.com" : `brand${String(i).padStart(2, "0")}.com`;
    return { domain, path: `/ads/${domain}`, name: domain };
  });

  it("hands every sampled /ads page at least 10 unique sibling cross-links", () => {
    for (const page of cohort.slice(0, 10)) {
      const cluster = pickRelatedBrandLinks(cohort, page.domain);
      const uniquePaths = new Set(cluster.map((link) => link.path));
      expect(uniquePaths.size).toBeGreaterThanOrEqual(10);
      // Every sibling link is a bare /ads/:domain path from the indexable
      // cohort — never an invented domain and never a /search handoff.
      for (const path of uniquePaths) {
        expect(path.startsWith("/ads/")).toBe(true);
        expect(cohort.some((link) => link.path === path)).toBe(true);
        expect(path).not.toBe("/search");
      }
      // A page never links to itself.
      expect(cluster.some((link) => link.domain === page.domain)).toBe(false);
    }
  });

  it("stays in sync with the sitemap-driven cohort — no hand-maintained subset", () => {
    // The cluster is a pure function of the caller's indexable set: shrink
    // the cohort and the cluster shrinks with it (all remaining others), so
    // there is no second data source to drift out of sync.
    const smallCohort = cohort.slice(0, 8);
    const cluster = pickRelatedBrandLinks(smallCohort, "nike.com");
    expect(cluster).toHaveLength(7);
    expect(cluster.every((link) => smallCohort.some((c) => c.path === link.path))).toBe(true);
  });
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

  // Issue #2314: the fresh sneaker/sport brands the global ICP knows are
  // preferred ahead of the historical Nykaa default, in a fixed precedence
  // order, with Nykaa kept only as the fallback when none of them is fresh.
  it("prefers a fresh sneaker/sport brand over Nykaa (issue #2314)", () => {
    const nike = { domain: "nike.com", path: "/ads/nike.com", name: "Nike" };
    const nykaaLink = { domain: "nykaa.com", path: "/ads/nykaa.com", name: "Nykaa" };
    expect(pickFeaturedAdsInternalLink([nykaaLink, nike])).toEqual(nike);
  });

  it("resolves the priority order Footlocker > New Balance > Adidas > Nike > JD Sports (issue #2314)", () => {
    const links: IndexableAdsLink[] = [
      { domain: "jdsports.com", path: "/ads/jdsports.com", name: "JD Sports" },
      { domain: "nike.com", path: "/ads/nike.com", name: "Nike" },
      { domain: "adidas.com", path: "/ads/adidas.com", name: "Adidas" },
      { domain: "newbalance.com", path: "/ads/newbalance.com", name: "New Balance" },
      { domain: "footlocker.com", path: "/ads/footlocker.com", name: "Foot Locker" },
      { domain: "nykaa.com", path: "/ads/nykaa.com", name: "Nykaa" },
    ];
    // All priority brands fresh → Footlocker (highest priority) wins.
    expect(pickFeaturedAdsInternalLink(links)).toEqual(
      expect.objectContaining({ domain: "footlocker.com" }),
    );
    // Only some fresh → the highest-priority present brand wins over a
    // lower-priority one and over Nykaa.
    expect(
      pickFeaturedAdsInternalLink([
        { domain: "nike.com", path: "/ads/nike.com", name: "Nike" },
        { domain: "newbalance.com", path: "/ads/newbalance.com", name: "New Balance" },
        nykaa,
      ]),
    ).toEqual(expect.objectContaining({ domain: "newbalance.com" }));
    expect(
      pickFeaturedAdsInternalLink([
        { domain: "jdsports.com", path: "/ads/jdsports.com", name: "JD Sports" },
        nykaa,
      ]),
    ).toEqual(expect.objectContaining({ domain: "jdsports.com" }));
  });

  it("falls back to Nykaa only when no fresh sneaker/sport brand is present (issue #2314)", () => {
    // All-stale fixture: no priority brand is in the fresh set → Nykaa.
    expect(pickFeaturedAdsInternalLink([nykaa, glossier], "nykaa.com")).toEqual(nykaa);
    // Even without a preferred domain, an unrelated fresh brand is preferred
    // over inventing Nykaa when Nykaa is absent too.
    expect(pickFeaturedAdsInternalLink([glossier])).toEqual(glossier);
  });

  it("uses the preferred domain as a fallback only after the sneaker priority, and never favours it over a fresh sneaker brand (issue #2314)", () => {
    const nike = { domain: "nike.com", path: "/ads/nike.com", name: "Nike" };
    // Nykaa is the preferred fallback, but a fresh sneaker brand wins.
    expect(pickFeaturedAdsInternalLink([nykaa, nike], "nykaa.com")).toEqual(nike);
    // No fresh sneaker brand → preferred fallback (nykaa).
    expect(pickFeaturedAdsInternalLink([nykaa, glossier], "nykaa.com")).toEqual(nykaa);
  });

  it("honors a caller-pinned priority sneaker brand so the homepage brief and featured link stay the same (issue #2314 regression guard)", () => {
    const nike = { domain: "nike.com", path: "/ads/nike.com", name: "Nike" };
    const footlocker = { domain: "footlocker.com", path: "/ads/footlocker.com", name: "Foot Locker" };
    // Homepage resolves featuredDomain=nike for a US/EU visitor; a lower-priority
    // sneaker must not displace it (the brief and "Try with Nike" still say nike).
    expect(pickFeaturedAdsInternalLink([footlocker, nike], "nike.com")).toEqual(nike);
    // When the pinned brand is stale/absent, fall back to the priority order.
    expect(pickFeaturedAdsInternalLink([footlocker], "nike.com")).toEqual(footlocker);
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
      featuredWebsiteForVisitorCountry: vi.fn(() => "nike.com"),
      PUBLIC_HOME_NEUTRAL_FEATURED_WEBSITE: "nike.com",
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
      changeMark: null,
      featuredDomain: "nike.com",
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

describe("compareAdsExampleLoader picks a non-Nykaa featured brand from the compare routes (issue #2314)", () => {
  // Accept (issue #2314): a compare route with a fresh sneaker-brand capture
  // shows a non-Nykaa brand in the featured-ads CTA, with and without a
  // CF-IPCountry header; Nykaa appears only in the all-stale fixture. The
  // loader resolves the same `/ads/:domain` link the `CompareAdsExampleLink`
  // component renders on the compare pages.
  beforeEach(() => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
  });

  it("shows a non-Nykaa brand when a fresh sneaker capture exists (CF-IPCountry: US)", async () => {
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nike.com" },
        { path: "/ads/footlocker.com" },
        { path: "/ads/nykaa.com" },
      ]),
    }));
    const { compareAdsExampleLoader } = await import("~/lib/ads-internal-links.server");
    const result = await compareAdsExampleLoader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/compare/pulzifi", {
        headers: { "cf-ipcountry": "US" },
      }),
    } as never);
    expect(result.featuredAdsLink?.domain).toBe("footlocker.com");
  });

  it("shows the same non-Nykaa brand with no country header", async () => {
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/adidas.com" },
        { path: "/ads/nike.com" },
      ]),
    }));
    const { compareAdsExampleLoader } = await import("~/lib/ads-internal-links.server");
    const result = await compareAdsExampleLoader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/compare/pulzifi"),
    } as never);
    expect(result.featuredAdsLink?.domain).toBe("adidas.com");
  });

  it("shows Nykaa only in the all-stale fixture (no fresh sneaker blanket capture)", async () => {
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nykaa.com" },
        { path: "/ads/glossier.com" },
      ]),
    }));
    const { compareAdsExampleLoader } = await import("~/lib/ads-internal-links.server");
    const result = await compareAdsExampleLoader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/compare/pulzifi", {
        headers: { "cf-ipcountry": "US" },
      }),
    } as never);
    expect(result.featuredAdsLink?.domain).toBe("nykaa.com");
  });
});

describe("resolveIndexableBrandPageLinkForDomain", () => {
  // Each test registers its own vi.doMock for ~/lib/sitemap.server rather than
  // sharing a describe-level beforeEach mock. In vitest 4, a test-body
  // vi.doMock does not reliably override a beforeEach vi.doMock registered
  // earlier in the same tick — the beforeEach factory can win, making the
  // open-ccTLD fallback tests flake (notion.com → null, glossier.com →
  // glossier). Registering once per test removes the override race entirely
  // (fleet-ops FleetMainRed 2026-09-06).

  it("resolves a search-derived domain to its indexable brand-page link", async () => {
    vi.resetModules();
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nykaa.com" },
        { path: "/ads/glossier.com" },
      ]),
    }));
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
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nykaa.com" },
        { path: "/ads/glossier.com" },
      ]),
    }));
    const { resolveIndexableBrandPageLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await resolveIndexableBrandPageLinkForDomain({}, "missingbrand.com")).toBeNull();
  });

  it("falls back to the open-ccTLD brand page when the resolved domain is its generic-commercial twin (issue #1431)", async () => {
    vi.resetModules();
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nykaa.com" },
        { path: "/ads/notion.so" },
      ]),
    }));
    const { resolveIndexableBrandPageLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    // A bare-keyword `notion` search resolves notion.com (the registrable
    // domain its result rows land on); the indexable brand page is the
    // open-ccTLD /ads/notion.so. The link must hand off to it.
    expect(await resolveIndexableBrandPageLinkForDomain({}, "notion.com")).toEqual({
      domain: "notion.so",
      path: "/ads/notion.so",
      name: "Notion",
    });
  });

  it("does not fall back to an open-ccTLD page for an unrelated label", async () => {
    vi.resetModules();
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nykaa.com" },
        { path: "/ads/notion.so" },
      ]),
    }));
    const { resolveIndexableBrandPageLinkForDomain } = await import(
      "~/lib/ads-internal-links.server"
    );
    expect(await resolveIndexableBrandPageLinkForDomain({}, "glossier.com")).toBeNull();
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
