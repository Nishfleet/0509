/**
 * Always-on canary for issue #1455: the programmatic-SEO union.
 *
 * BET 5's /ads/:domain surface only counts as a real surface when each
 * populated page satisfies ALL THREE conditions simultaneously:
 *   (a) it does NOT serve `<meta name="robots" content="noindex">`,
 *   (b) it is listed in the production sitemap, AND
 *   (c) it is reachable from `/search?q=<brand>` via a brand-page link.
 *
 * The four underlying issues each own one defect individually (#1431
 * noindex-and-sitemap, #1447 meta-hedge-vs-score, #1441 search-to-brand-page,
 * #1283 every-sitemap-URL-serves-noindex), and the #1283 parity guard already
 * pins sitemap-vs-noindex together. This guard is the union: it asserts the
 * three conditions hold on the SAME populated page shape, so a fix to one
 * condition can never silently regress another (the exact gap the issue's
 * impact section names).
 *
 * It is a single grep-able canary: `--grep "ads.programmatic.seo.canary"`.
 * Follows the #1454 combined-canary precedent (a render-level guard in the
 * node vitest project, not a live-fetch job) — deterministic, additive, and
 * run in the normal `npm test` gate. Condition (c) drives the real search→
 * brand-page handoff chain (resolveSearchBrandPageDomain →
 * resolveIndexableBrandPageLinkForDomain) rather than a hand-set fixture,
 * so a regression in the #1441 logic fails here. The live-production half of
 * (a)+(b) is covered by tests/seo/sitemap-noindex-parity.test.sh, and the
 * #1283 code-level parity guard (tests/seo/sitemap-noindex-parity.test.ts)
 * pins the sitemap-vs-noindex predicates together for the same page shape.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  indexableBrandPageEntriesFromRows,
  type SitemapCacheRow,
} from "~/lib/sitemap.server";
import { resolveSearchBrandPageDomain } from "~/lib/ads-internal-links";
import type { AdRecord } from "~/lib/types";
import { emptyCompetitorWebsite } from "~/lib/competitor-website";
import { buildIdleSearchResult } from "~/lib/search-display";
import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import {
  resolveIndexableBrandPageLinkForDomain,
} from "~/lib/ads-internal-links.server";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * A populated brand page fixture: a verified-linked ad for nike.com with a
 * fresh snapshot. This is the shape the union rule protects.
 */
function verifiedAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "meta-nike-1",
    advertiser: "Nike",
    body: "Charge shin guards",
    previewHeadline: "Charge shin guards",
    previewSubhead: "New drop",
    hook: "Charge shin guards",
    offer: "Shop",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://nike.com/shop",
    adSnapshotUrl: "https://cdn.example.com/meta-nike-1.png",
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: isoAgo(2 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "Sneaker cohort weekly summary",
    source: "meta_library_browser",
    analysisFields: [],
    domainMatch: {
      level: "registrable_domain",
      reason: "Landing page matches nike.com",
      matchedDomain: "nike.com",
    },
    ...overrides,
  };
}

function populatedAds(): AdRecord[] {
  return Array.from({ length: 6 }, (_v, i) =>
    verifiedAd({ metaAdId: `meta-nike-${i + 1}` } as Partial<AdRecord>),
  );
}

function sitemapRow(ads: AdRecord[]): SitemapCacheRow {
  // cache_key must track buildSearchV2CacheKey's exact format (domain + route
  // context + provider + country + page) — the sitemap gates on lookup parity
  // against that key shape, so a format change there would read this row as a
  // cache miss and silently drop the brand page. Verified against
  // app/lib/search-v2.server.ts buildSearchV2CacheKey.
  return {
    cache_key: "search-v2:domain:nike.com:exact:meta_library_browser:all:page-1",
    provider: "meta_library_browser",
    route_context: "public_search",
    payload_json: JSON.stringify({
      ads,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
    }),
    // Stable, well-within the 7-day freshness window (never a `now`-edge):
    // mirrors the passing sitemap/noindex parity fixture (#1283).
    fetched_at: isoAgo(2 * 60 * 60 * 1000),
  };
}

/** The /ads/:domain loader payload for the fully populated indexable page. */
function adsPageData(): BrandPageLoaderData {
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads: populatedAds(),
    adCount: populatedAds().length,
    verifiedTestedCount: 0,
    tickerAds: [],
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-08-09T10:00:00.000Z",
    freshForLiveClaim: false,
    brandOwnedAdCount: 6,
    verifiedLinkCount: 6,
    unverifiedMatchCount: 0,
    partnerCampaignAdIds: [],
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
      bandId: "all_out" as const,
      bandLabel: "All-out",
      bandInterpretation: "Running an all-out launch and testing push.",
      formulaVersion: 1 as const,
      windowDays: 21,
      adsPerWeek: 6,
      adCount: 6,
      activeCount: 6,
    },
    observationDays: null,
    changeEvents: [],
    offerTimelineEntries: [],
    adLibraryCountry: "India",
    noindex: false,
    relatedBrands: [],
    canonicalPath: "/ads/nike.com",
    timelineIndexable: false,
    captureFailuresSummary: null,
    recentWatchChanges: [],
    sourceSnapshots: [],
  };
}

/** The /search loader payload with the resolved brandPageLink handoff. */
function searchPageData() {
  return {
    mode: "advertiser" as const,
    filters: {
      query: "nike",
      country: "all",
      platform: "all",
      creativeType: "all" as const,
      status: "all" as const,
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
    fingerprint: "fp-nike",
    result: { ...buildIdleSearchResult(), discoveryStatus: "demo" as const },
    selectedAd: null,
    stealSummary: null,
    selectionEnrichmentPending: false,
    collections: [],
    plan: null,
    session: null,
    competitorWebsite: emptyCompetitorWebsite(),
    trackingRole: "competitor" as const,
    inputError: null,
    searchScope: "exact" as const,
    displayDomain: null,
    brandPageLink: { path: "/ads/nike.com", name: "Nike" },
    switchPage: null,
    relevanceApplied: false,
    watchedWatchlist: null,
    showOpsNav: false,
    showPresenceNav: false,
  };
}

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      useActionData: () => undefined,
      useLoaderData: vi.fn().mockReturnValue(searchPageData()),
      useLocation: () => ({ pathname: "/search", search: "?q=nike", hash: "" }),
      useNavigate: () => vi.fn(),
      useNavigation: () => ({ state: "idle" }),
      useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: () => ({ session: null }),
      useFetcher: () =>
        ({ state: "idle", Form: ({ children }: { children?: ReactNode }) =>
          React.createElement("form", null, children), load: vi.fn() }),
      useSubmit: () => vi.fn(),
    };
  });
  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  // vi.doMock registrations are scoped per-test and cleared by vi.resetModules,
  // so test 2's ~/lib/sitemap.server stub does not leak (same pattern as
  // tests/ads-internal-links.test.ts). No vi.unmock here: vitest hoists it to
  // module top-level regardless of placement, which warns and would be an error
  // in a future vitest version.
  vi.resetModules();
});

describe("ads.programmatic.seo.canary — populated page satisfies noindex + sitemap + search union (issue #1455)", () => {
  it("(a+b) a populated page is not-noindex (meta emits no robots-noindex) AND qualifies for the sitemap", async () => {
    // (b) sitemap-listed: the populated row qualifies as an indexable brand
    // page entry, so the sitemap will emit /ads/nike.com (issue #1283 parity).
    const now = new Date();
    const entries = indexableBrandPageEntriesFromRows([sitemapRow(populatedAds())], now);
    expect(entries.map((e) => e.path)).toContain("/ads/nike.com");

    // (a) not-noindex: the route's `meta` function — the exact thing that
    // emits `<meta name="robots" content="noindex">` on the rendered page —
    // must omit the noindex robots descriptor for the populated indexable
    // shape. The meta function reads loaderData.noindex and adds the
    // descriptor only when it is true (ads.$domain.tsx), so asserting the
    // descriptors is the faithful, deterministic twin of the live tag.
    // NOTE: this guards the meta-EMISSION half of (a); the loader's decision
    // that a populated fresh page sets noindex=false is pinned by the #1283
    // parity guard (tests/seo/sitemap-noindex-parity.test.ts) on the same
    // page shape, so this canary stays focused on the union, not re-deriving
    // noindex.
    vi.resetModules();
    const adsRoute = await import("~/routes/ads.$domain");
    const metaFn = adsRoute.meta as unknown as (args: {
      loaderData: BrandPageLoaderData;
    }) => Array<Record<string, string>>;
    const metaDescriptors = metaFn({ loaderData: adsPageData() });
    expect(
      metaDescriptors.some(
        (d) => d.name === "robots" && d.content === "noindex",
      ),
    ).toBe(false);
  });

  it("(c) the populated page is reachable from /search via a brand-page link", async () => {
    // The search route hands off to the /ads/:domain leaf with "See all
    // {brand} ads" → /ads/nike.com when brandPageLink is resolved (issue
    // #1441), gated server-side on the sitemap indexability filter. Drive the
    // REAL handoff chain so the canary catches a regression in the search→
    // brand-page resolution itself, not just in the renderer:
    //   resolveSearchBrandPageDomain → resolveIndexableBrandPageLinkForDomain.
    // The populated ads carry domainMatch.matchedDomain "nike.com" (the same
    // shape (a)+(b) proved is not-noindex and sitemap-listed), so a bare
    // keyword search resolves nike.com and hands off to the indexable page.
    const candidate = resolveSearchBrandPageDomain({
      displayDomain: null,
      ads: populatedAds(),
    });
    expect(candidate).toBe("nike.com");

    // The brand page must be in the sitemap's indexable set for the search
    // handoff to render (same predicate as (a)+(b)).
    vi.resetModules();
    vi.doMock("~/lib/sitemap.server", () => ({
      loadIndexableBrandPageEntries: vi.fn().mockResolvedValue([
        { path: "/ads/nike.com" },
      ]),
    }));
    const { resolveIndexableBrandPageLinkForDomain: resolveLive } = await import(
      "~/lib/ads-internal-links.server"
    );
    const link = await resolveLive({}, candidate);
    expect(link).toEqual({
      domain: "nike.com",
      path: "/ads/nike.com",
      name: "Nike",
    });

    // Rendering half: the search route surfaces "See all Nike ads" →
    // /ads/nike.com when brandPageLink is present (the same shape the search
    // loader builds from the resolved link).
    const { default: SearchRoute } = await import("~/routes/search");
    const searchMarkup = renderToStaticMarkup(createElement(SearchRoute));
    expect(searchMarkup).toContain("See all Nike ads");
    expect(searchMarkup).toMatch(/href="\/ads\/nike\.com"/);
  });

  it("the union is conditional: a thin (zero-verified) page is excluded from the sitemap", () => {
    // A page with only text-mention matches (no verified link evidence) is
    // content-thin and must be absent from the sitemap (indexability is
    // content-thinness, not score — issue #1442), so it can never be handed
    // off as a brandPageLink destination either. Mirror the parity fixture's
    // thin shape: no landing URL and no verified domainMatch level.
    const thinAd: AdRecord = {
      ...verifiedAd(),
      landingPageUrl: null,
      domainMatch: undefined,
    };
    const now = new Date();
    const entries = indexableBrandPageEntriesFromRows([sitemapRow([thinAd])], now);
    expect(entries.map((e) => e.path)).not.toContain("/ads/nike.com");
    expect(entries).toHaveLength(0);
  });
});
