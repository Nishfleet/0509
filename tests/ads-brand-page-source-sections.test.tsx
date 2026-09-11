import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrandPageLoaderData } from "~/routes/ads.$domain";
import type { AdRecord } from "~/lib/types";
import type { BrandPageSourceSnapshot } from "~/components/brand-page/source-snapshots.server";

// The default export reads `useLoaderData`; a mutable fixture lets each test
// render the route with a specific loader payload (same pattern as
// ads-brand-page.render.test.tsx).
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
      useLocation: () => ({ pathname: "/ads/nike.com" }),
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
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

const teaser = {
  totalCount: 6,
  activeCount: 6,
  longestRunningDays: 126,
  longestRunningHook: "Charge shin guards",
  formats: ["image", "video", "carousel"],
};

const aggression = {
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
};

function populated(overrides: Partial<BrandPageLoaderData> = {}): BrandPageLoaderData {
  return {
    domain: "nike.com",
    brandName: "Nike",
    hasCachedAds: true,
    ads: [ad()],
    adCount: 1,
    verifiedTestedCount: 0,
    tickerAds: [],
    checkedAgo: "about 2 hours ago",
    lastCheckedAt: "2026-09-01T10:00:00.000Z",
    freshForLiveClaim: false,
    brandOwnedAdCount: 6,
    verifiedLinkCount: 6,
    unverifiedMatchCount: 0,
    partnerCampaignAdIds: [],
    teaser,
    aggression,
    observationDays: null,
    changeEvents: [],
    offerTimelineEntries: [],
    timelineIndexable: true,
    adLibraryCountry: "India",
    noindex: false,
    relatedBrands: [],
    canonicalPath: "/ads/nike.com",
    captureFailuresSummary: null,
    recentWatchChanges: [],
    sourceSnapshots: [],
    ...overrides,
  };
}

function googleAdsSnapshot(): BrandPageSourceSnapshot {
  return {
    sourceId: "google_ads",
    label: "Google Ads (Transparency Center)",
    snapshot: {
      id: "snap-google-ads-1",
      watchlistId: "wl-1",
      sourceId: "google_ads",
      fetchedAt: "2026-09-01T08:00:00.000Z",
      payload: {
        domain: "nike.com",
        fetchedAt: "2026-09-01T08:00:00.000Z",
        truncated: false,
        creatives: [
          {
            advertiserId: "AR123",
            advertiserName: "Nike",
            creativeId: "CR456",
            format: "image",
            domain: "nike.com",
            firstShownAt: "2026-08-15T00:00:00.000Z",
            lastShownAt: "2026-09-01T00:00:00.000Z",
            previewUrl: "https://example.com/preview.png",
          },
        ],
        advertiserCount: 1,
        formatMix: { text: 0, image: 1, video: 0, unknown: 0 },
      },
      createdAt: "2026-09-01T08:00:00.000Z",
    },
  };
}

function subdomainsSnapshot(): BrandPageSourceSnapshot {
  return {
    sourceId: "subdomains",
    label: "New web addresses",
    snapshot: {
      id: "snap-sub-1",
      watchlistId: "wl-1",
      sourceId: "subdomains",
      fetchedAt: "2026-09-01T07:00:00.000Z",
      payload: {
        domain: "nike.com",
        names: [
          { name: "new.nike.com", kind: "public", firstSeen: "2026-08-20T00:00:00.000Z" },
          { name: "internal.nike.com", kind: "internal", firstSeen: "2026-08-22T00:00:00.000Z" },
        ],
        truncated: false,
      },
      createdAt: "2026-09-01T07:00:00.000Z",
    },
  };
}

function tiktokSnapshot(): BrandPageSourceSnapshot {
  return {
    sourceId: "tiktok",
    label: "TikTok ads (Commercial Content Library, EU-shown)",
    snapshot: {
      id: "snap-tiktok-1",
      watchlistId: "wl-1",
      sourceId: "tiktok",
      fetchedAt: "2026-09-01T06:00:00.000Z",
      payload: {
        ads: [
          {
            adId: "tiktok-1",
            advertiser: "Nike",
            firstShown: "2026-08-10",
            lastShown: "2026-09-01",
            uniqueUsers: "1.2M",
            thumbnail: null,
          },
        ],
        totalAds: 5,
        legalName: "Nike",
      },
      createdAt: "2026-09-01T06:00:00.000Z",
    },
  };
}

describe("/ads/:domain source sections (issue #2200)", () => {
  it("renders the Google Ads inventory section when a live snapshot exists", async () => {
    const markup = await render(
      populated({ sourceSnapshots: [googleAdsSnapshot()] }),
    );
    expect(markup).toContain('id="brand-google-ads-title"');
    expect(markup).toContain("Google Ads inventory");
    // One factual sentence + the data (creative count, advertiser).
    expect(markup).toContain("1 creative");
    expect(markup).toContain("across 1 advertiser");
    // "Last checked" line in the body, not in title/description.
    expect(markup).toContain('data-testid="brand-google-ads-checked"');
    expect(markup).toContain("Last checked");
  });

  it("renders the New web addresses section when a live snapshot exists", async () => {
    const markup = await render(
      populated({ sourceSnapshots: [subdomainsSnapshot()] }),
    );
    expect(markup).toContain('id="brand-subdomains-title"');
    expect(markup).toContain("New web addresses");
    expect(markup).toContain("new.nike.com");
  });

  it("renders the TikTok ads section when a live snapshot exists", async () => {
    const markup = await render(
      populated({ sourceSnapshots: [tiktokSnapshot()] }),
    );
    expect(markup).toContain('id="brand-tiktok-ads-title"');
    expect(markup).toContain("TikTok ads");
    expect(markup).toContain("EU-shown");
  });

  it("renders sections in the fixed order: Google Ads, Google Search, LinkedIn, TikTok, subdomains, hiring", async () => {
    const markup = await render(
      populated({
        sourceSnapshots: [
          subdomainsSnapshot(),
          googleAdsSnapshot(),
          tiktokSnapshot(),
        ],
      }),
    );
    const subdomainsIdx = markup.indexOf('id="brand-subdomains-title"');
    const googleAdsIdx = markup.indexOf('id="brand-google-ads-title"');
    const tiktokIdx = markup.indexOf('id="brand-tiktok-ads-title"');
    // Google Ads before TikTok before subdomains (the fixed render order,
    // regardless of the input array order).
    expect(googleAdsIdx).toBeLessThan(tiktokIdx);
    expect(tiktokIdx).toBeLessThan(subdomainsIdx);
  });

  it("omits every source section when no live snapshot exists (empty array)", async () => {
    const markup = await render(populated({ sourceSnapshots: [] }));
    expect(markup).not.toContain('id="brand-google-ads-title"');
    expect(markup).not.toContain('id="brand-subdomains-title"');
    expect(markup).not.toContain('id="brand-tiktok-ads-title"');
    expect(markup).not.toContain('id="brand-google-search-title"');
    expect(markup).not.toContain('id="brand-linkedin-ads-title"');
    expect(markup).not.toContain('id="brand-hiring-title"');
  });

  it("omits a source whose renderer returns null for an empty payload", async () => {
    // A google_ads snapshot with zero creatives → the renderer returns null
    // → the section omits entirely (no placeholder).
    const emptyGoogleAds: BrandPageSourceSnapshot = {
      sourceId: "google_ads",
      label: "Google Ads (Transparency Center)",
      snapshot: {
        id: "snap-empty",
        watchlistId: "wl-1",
        sourceId: "google_ads",
        fetchedAt: "2026-09-01T08:00:00.000Z",
        payload: {
          domain: "nike.com",
          fetchedAt: "2026-09-01T08:00:00.000Z",
          truncated: false,
          creatives: [],
          advertiserCount: 0,
          formatMix: { text: 0, image: 0, video: 0, unknown: 0 },
        },
        createdAt: "2026-09-01T08:00:00.000Z",
      },
    };
    const markup = await render(populated({ sourceSnapshots: [emptyGoogleAds] }));
    expect(markup).not.toContain('id="brand-google-ads-title"');
  });

  it("keeps the title unchanged in shape — no source counts or dates in <title>", async () => {
    const routeModule = (await import("~/routes/ads.$domain")) as unknown as {
      meta: (args: { loaderData: BrandPageLoaderData }) => ReadonlyArray<{
        title?: string;
        name?: string;
        content?: string;
        tagName?: string;
        rel?: string;
        href?: string;
      }>;
    };
    const data = populated({ sourceSnapshots: [googleAdsSnapshot()] });
    const entries = routeModule.meta({ loaderData: data });
    const title = entries.find((e) => e.title)?.title;
    expect(title).toBeDefined();
    // The title must NOT carry source counts or "checked" freshness text.
    expect(title).not.toMatch(/\d+ creative/);
    expect(title).not.toMatch(/checked/i);
    // The title still names the brand and the Meta ads surface.
    expect(title).toContain("Nike");
  });

  it("keeps the meta description unchanged in shape — no source counts or dates", async () => {
    const routeModule = (await import("~/routes/ads.$domain")) as unknown as {
      meta: (args: { loaderData: BrandPageLoaderData }) => ReadonlyArray<{
        name?: string;
        content?: string;
      }>;
    };
    const data = populated({ sourceSnapshots: [googleAdsSnapshot()] });
    const entries = routeModule.meta({ loaderData: data });
    const description = entries.find((e) => e.name === "description")?.content;
    expect(description).toBeDefined();
    expect(description).not.toMatch(/\d+ creative/);
    expect(description).not.toMatch(/checked/i);
  });

  it("keeps the canonical unchanged when source snapshots exist", async () => {
    const routeModule = (await import("~/routes/ads.$domain")) as unknown as {
      meta: (args: { loaderData: BrandPageLoaderData }) => ReadonlyArray<{
        tagName?: string;
        rel?: string;
        href?: string;
      }>;
    };
    const data = populated({ sourceSnapshots: [googleAdsSnapshot()] });
    const entries = routeModule.meta({ loaderData: data });
    const canonical = entries.find(
      (e) => e.tagName === "link" && e.rel === "canonical",
    )?.href;
    expect(canonical).toBe("https://0509.io/ads/nike.com");
  });

  it("keeps the soft-404 gate intact — a brand with no Meta data and no source data still has no source sections", async () => {
    // The soft-404 gate (#2097) is loader-level: a brand with no Meta data
    // redirects. At the render level, the source-sections block omits when
    // sourceSnapshots is empty, so a thin page never carries source chrome.
    const markup = await render(populated({ sourceSnapshots: [] }));
    expect(markup).not.toContain('id="brand-google-ads-title"');
  });
});

describe("/ads/:domain loader source snapshots (issue #2200)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  function isoAgo(ms: number) {
    return new Date(Date.now() - ms).toISOString();
  }

  const baseAd: AdRecord = {
    metaAdId: "meta-1",
    advertiser: "Nike",
    body: "Run.",
    previewHeadline: "Run.",
    previewSubhead: "",
    hook: "Run.",
    offer: "",
    cta: "Shop",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nike.com/launch",
    advertiserPageId: "1",
    adSnapshotUrl: "https://cdn.example.com/meta-1.png",
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: isoAgo(30 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    domainMatch: {
      level: "registrable_domain",
      reason: "Landing page matches nike.com",
      matchedDomain: "nike.com",
    },
  };

  function cacheEntry() {
    return {
      cacheKey: "meta_library_browser:fnv1a-test:all:page-1",
      provider: "meta_library_browser",
      routeContext: "public_search",
      queryFingerprint: "fnv1a-test",
      country: "all",
      cursor: null,
      payload: {
        ads: [baseAd],
        nextCursor: null,
        source: "meta_library_browser",
        provider: "meta_library_browser",
        cacheStatus: "hit",
      },
      fetchedAt: isoAgo(2 * 60 * 60 * 1000),
      expiresAt: isoAgo(60 * 60 * 1000),
      browserMsUsed: 1200,
      createdAt: isoAgo(2 * 60 * 60 * 1000),
      updatedAt: isoAgo(2 * 60 * 60 * 1000),
    };
  }

  function createContext(env: Record<string, unknown>) {
    return { cloudflare: { env } };
  }

  function installMocks(options: {
    entry?: ReturnType<typeof cacheEntry> | null;
    sourceSnapshots?: BrandPageSourceSnapshot[];
  } = {}) {
    const env = { DB: {} };
    const getDiscoveryCacheEntry = vi
      .fn()
      .mockImplementation(async () => options.entry ?? null);
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/data.server", () => ({ getDiscoveryCacheEntry }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn(),
      hasFreshDiscoveryCacheEntry: vi.fn(),
    }));
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: vi.fn(),
    }));
    vi.doMock("~/lib/meta-api.server", () => ({ searchAds: vi.fn() }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/offer-timeline.server", () => ({
      loadOfferTimeline: vi.fn().mockResolvedValue({ entries: [], asOfState: null }),
      loadDomainCaptureFailures: vi.fn().mockResolvedValue([]),
      summarizeDomainCaptureFailures: vi.fn(() => null),
      isOfferTimelineShareEnabled: vi.fn(() => true),
    }));
    vi.doMock("~/lib/ads-domain-recent-changes.server", () => ({
      loadAdsDomainRecentChanges: vi.fn().mockResolvedValue([]),
    }));
    const loadBrandPageSourceSnapshots = vi
      .fn()
      .mockResolvedValue(options.sourceSnapshots ?? []);
    vi.doMock("~/components/brand-page/source-snapshots.server", () => ({
      loadBrandPageSourceSnapshots,
    }));
    return { env, loadBrandPageSourceSnapshots };
  }

  async function runLoader(domain: string, env: Record<string, unknown>) {
    const { loader } = await import("~/routes/ads.$domain");
    return loader({
      context: createContext(env),
      params: { domain },
      request: new Request(`http://localhost/ads/${encodeURIComponent(domain)}`),
    } as never);
  }

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock("~/lib/context.server");
    vi.doUnmock("~/lib/data.server");
    vi.doUnmock("~/lib/ad-source.server");
    vi.doUnmock("~/lib/meta-library-browser.server");
    vi.doUnmock("~/lib/meta-api.server");
    vi.doUnmock("~/lib/rate-limit.server");
    vi.doUnmock("~/lib/offer-timeline.server");
    vi.doUnmock("~/lib/ads-domain-recent-changes.server");
    vi.doUnmock("~/components/brand-page/source-snapshots.server");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("loads source snapshots into the loader data when a brand page renders", async () => {
    const mocks = installMocks({
      entry: cacheEntry(),
      sourceSnapshots: [googleAdsSnapshot()],
    });
    const result = await runLoader("nike.com", mocks.env);
    expect(result.sourceSnapshots).toEqual([googleAdsSnapshot()]);
    expect(mocks.loadBrandPageSourceSnapshots).toHaveBeenCalledWith(
      mocks.env,
      "nike.com",
    );
  });

  it("degrades to empty sourceSnapshots when the snapshot read fails (never 500s)", async () => {
    const env = { DB: {} };
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
    vi.doMock("~/lib/data.server", () => ({
      getDiscoveryCacheEntry: vi.fn().mockResolvedValue(cacheEntry()),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn(),
      hasFreshDiscoveryCacheEntry: vi.fn(),
    }));
    vi.doMock("~/lib/meta-library-browser.server", () => ({
      searchMetaLibraryByBrowser: vi.fn(),
    }));
    vi.doMock("~/lib/meta-api.server", () => ({ searchAds: vi.fn() }));
    vi.doMock("~/lib/rate-limit.server", () => ({
      enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/offer-timeline.server", () => ({
      loadOfferTimeline: vi.fn().mockResolvedValue({ entries: [], asOfState: null }),
      loadDomainCaptureFailures: vi.fn().mockResolvedValue([]),
      summarizeDomainCaptureFailures: vi.fn(() => null),
      isOfferTimelineShareEnabled: vi.fn(() => true),
    }));
    vi.doMock("~/lib/ads-domain-recent-changes.server", () => ({
      loadAdsDomainRecentChanges: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock("~/components/brand-page/source-snapshots.server", () => ({
      loadBrandPageSourceSnapshots: vi.fn().mockRejectedValue(new Error("D1 down")),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runLoader("nike.com", env);
    expect(result.sourceSnapshots).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("never triggers a provider fetch — only the read-only snapshot loader runs", async () => {
    const mocks = installMocks({
      entry: cacheEntry(),
      sourceSnapshots: [googleAdsSnapshot()],
    });
    await runLoader("nike.com", mocks.env);
    // The snapshot loader is the ONLY source read; it never fetches.
    expect(mocks.loadBrandPageSourceSnapshots).toHaveBeenCalledTimes(1);
  });
});

describe("/de/ads/:domain locale route renders the same source sections (issue #2200)", () => {
  it("the locale child re-exports the EN route, so source sections render identically", async () => {
    currentData = populated({ sourceSnapshots: [googleAdsSnapshot()] });
    const { default: LocaleAdsRoute } = await import("~/routes/$locale.ads.$domain");
    const markup = renderToStaticMarkup(createElement(LocaleAdsRoute));
    // The locale route renders the same Google Ads section the EN route does.
    expect(markup).toContain('id="brand-google-ads-title"');
    expect(markup).toContain("Google Ads inventory");
  });
});

describe("/ads/:domain source sections tolerate a loader payload without the field (issue #2200)", () => {
  it("renders the page instead of throwing when sourceSnapshots is absent", async () => {
    // Regression: the public SEO page must degrade to "no source sections",
    // never 500, when the payload predates the field (a stale test fixture or
    // an older cached response shape). The crash this pins was a real CI
    // failure: `Cannot read properties of undefined (reading 'length')` in
    // BrandPageSourceSections.
    const data = populated();
    delete (data as { sourceSnapshots?: unknown }).sourceSnapshots;
    const markup = await render(data);
    expect(markup).toContain("Nike");
    expect(markup).not.toContain('id="brand-google-ads-title"');
  });

  it("renders the page instead of throwing when sourceSnapshots is null", async () => {
    const markup = await render(populated({ sourceSnapshots: null as unknown as BrandPageSourceSnapshot[] }));
    expect(markup).toContain("Nike");
    expect(markup).not.toContain('id="brand-google-ads-title"');
  });
});

// ---------------------------------------------------------------------------
// Loader-level: the claim gate + snapshot presence (issue #2200 step 1).
// These drive loadBrandPageSourceSnapshots against a fake D1 instead of a
// stubbed snapshot array, so the actual gate the issue is about —
// "live claim row AND a stored snapshot" — is proven, not assumed.
// ---------------------------------------------------------------------------

describe("loadBrandPageSourceSnapshots — the claim gate and snapshot presence (issue #2200 step 1)", () => {
  function fakeD1(watchlists: unknown[], snapshots: unknown[]) {
    const sqls: string[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind(..._b: unknown[]) {
              sqls.push(sql);
              return {
                async all() {
                  if (sql.includes("FROM watchlist")) return { results: watchlists };
                  throw new Error(`Unexpected all(): ${sql}`);
                },
                async first() {
                  if (sql.includes("FROM source_snapshot")) {
                    return snapshots.find((s) => {
                      const row = s as { source_id: string };
                      return row.source_id === _b[1];
                    }) ?? null;
                  }
                  throw new Error(`Unexpected first(): ${sql}`);
                },
              };
            },
          };
        },
      },
    } as never;
    return { env, sqls };
  }

  function snapshotRow(sourceId: string, fetchedAt: string) {
    return {
      id: `snap-${sourceId}`,
      watchlist_id: "wl-1",
      source_id: sourceId,
      fetched_at: fetchedAt,
      payload_json: JSON.stringify({ domain: "nike.com", fetchedAt }),
      created_at: fetchedAt,
    };
  }

  const tracking = [{ id: "wl-1", target_id: "https://nike.com" }];

  it("omits a source whose snapshot exists but whose claim row is not live", async () => {
    // `google` is a registered but NOT-implemented adapter (stub), so its
    // claim row is not live. A stored snapshot must NOT render it.
    const { env } = fakeD1(tracking, [
      snapshotRow("google", "2026-09-01T00:00:00Z"),
      snapshotRow("google_ads", "2026-09-01T00:00:00Z"),
    ]);
    const { loadBrandPageSourceSnapshots } = await import(
      "~/components/brand-page/source-snapshots.server"
    );
    const result = await loadBrandPageSourceSnapshots(env, "nike.com");
    // The live source with a snapshot comes back; the not-live one does not.
    expect(result.map((r) => r.sourceId)).toEqual(["google_ads"]);
  });

  it("omits a live source that has no stored snapshot", async () => {
    const { env } = fakeD1(tracking, []);
    const { loadBrandPageSourceSnapshots } = await import(
      "~/components/brand-page/source-snapshots.server"
    );
    const result = await loadBrandPageSourceSnapshots(env, "nike.com");
    expect(result).toEqual([]);
  });

  it("returns a live source that has a stored snapshot for the tracking watchlist", async () => {
    const { env } = fakeD1(tracking, [snapshotRow("google_ads", "2026-09-01T00:00:00Z")]);
    const { loadBrandPageSourceSnapshots } = await import(
      "~/components/brand-page/source-snapshots.server"
    );
    const result = await loadBrandPageSourceSnapshots(env, "nike.com");
    expect(result.map((r) => r.sourceId)).toEqual(["google_ads"]);
  });

  it("ignores a watchlist that tracks a different domain", async () => {
    const { env } = fakeD1(
      [{ id: "wl-1", target_id: "https://adidas.com" }],
      [snapshotRow("google_ads", "2026-09-01T00:00:00Z")],
    );
    const { loadBrandPageSourceSnapshots } = await import(
      "~/components/brand-page/source-snapshots.server"
    );
    const result = await loadBrandPageSourceSnapshots(env, "nike.com");
    expect(result).toEqual([]);
  });
});
