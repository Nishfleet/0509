import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #2390 — the /ads/:domain loader ran its independent secondary reads
 * strictly sequentially, paying the SUM of their latencies (measured TTFB
 * 0.71s). This suite pins the fix: the reads must be IN FLIGHT AT THE SAME
 * TIME, not a waterfall.
 *
 * Both cases mock only the two LEAF reads the loader's dependencies bottom out
 * in — the discovery-cache row (`~/lib/data.server`) that feeds the snapshot
 * gate, and the sitemap brand-page entries (`~/lib/sitemap.server`) that feed
 * the internal-links read. Everything else runs for real, so the assertions
 * are about the loader's own control flow, not about mocks being called.
 */

const ONE_HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

const baseAd = {
  metaAdId: "meta-nykaa-1",
  advertiser: "Nykaa",
  body: "Glow like never before.",
  previewHeadline: "Glow like never before.",
  previewSubhead: "Festive sale",
  hook: "Glow like never before.",
  offer: "Up to 40% off",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: "https://www.nykaa.com/glow",
  advertiserPageId: "111",
  adSnapshotUrl: "https://cdn.example.com/meta-nykaa-1.png",
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
    reason: "Landing page matches nykaa.com",
    matchedDomain: "nykaa.com",
  },
};

/** The shape `readDiscoveryCacheEntryCacheOnly` returns for a usable entry. */
const discoveryCacheEntry = {
  cacheKey: "meta_library_browser:fnv1a-test:all:page-1",
  provider: "meta_library_browser",
  routeContext: "public_search",
  fetchedAt: isoAgo(ONE_HOUR_MS),
  payload: {
    ads: [baseAd],
    source: "meta_library_browser",
    provider: "meta_library_browser",
  },
};

/**
 * A rendezvous barrier: `arrive()` resolves only once `expected` callers have
 * arrived. `arrived` records labels so a failure names who actually showed up.
 */
function createBarrier(expected: number) {
  const arrived: string[] = [];
  let release: (() => void) | null = null;
  const all = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    arrived,
    async arrive(label: string) {
      arrived.push(label);
      if (arrived.length >= expected) {
        release?.();
      }
      await all;
    },
  };
}

function installBaseMocks(env: Record<string, unknown>) {
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getDiscoveryCacheEntry: vi.fn().mockResolvedValue(discoveryCacheEntry),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
    searchAdsViaSourceResolver: vi.fn(),
    hasFreshDiscoveryCacheEntry: vi.fn(),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(null),
  }));
}

async function runLoader(env: Record<string, unknown>, domain = "nykaa.com") {
  const { loader } = await import("~/routes/ads.$domain");
  return loader({
    context: { cloudflare: { env } },
    params: { domain },
    request: new Request(`http://localhost/ads/${domain}`),
  } as never);
}

describe("/ads/:domain concurrent secondary reads (issue #2390)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const specifier of [
      "~/lib/context.server",
      "~/lib/data.server",
      "~/lib/ad-source.server",
      "~/lib/rate-limit.server",
      "~/lib/sitemap.server",
    ]) {
      vi.doUnmock(specifier);
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("has the six independent reads in flight simultaneously, not a waterfall", async () => {
    const barrier = createBarrier(6);
    const env = { DB: {} };
    installBaseMocks(env);

    vi.doMock("~/lib/sitemap.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      // The "related brands" read bottoms out in the brand-entries leaf and
      // the timeline-indexability read bottoms out in the capture-backed
      // timeline-entries leaf (issue #2881: no brand-entries call in the
      // internal-links path anymore), so each leaf carries its own label.
      loadIndexableBrandPageEntries: vi.fn().mockImplementation(async () => {
        await barrier.arrive("sitemapBrandEntries");
        return [];
      }),
      loadIndexableTimelineEntries: vi.fn().mockImplementation(async () => {
        await barrier.arrive("sitemapTimelineEntries");
        return [];
      }),
    }));

    vi.doMock("~/lib/offer-timeline.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadOfferTimeline: vi.fn().mockImplementation(async () => {
        await barrier.arrive("offerTimeline");
        return { entries: [], asOfState: null };
      }),
      loadDomainCaptureFailures: vi.fn().mockImplementation(async () => {
        await barrier.arrive("captureFailures");
        return [];
      }),
    }));

    vi.doMock("~/lib/ads-domain-recent-changes.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadAdsDomainRecentChanges: vi.fn().mockImplementation(async () => {
        await barrier.arrive("recentWatchChanges");
        return [];
      }),
    }));

    vi.doMock("~/components/brand-page/source-snapshots.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadBrandPageSourceSnapshots: vi.fn().mockImplementation(async () => {
        await barrier.arrive("sourceSnapshots");
        return [];
      }),
    }));

    const result = await runLoader(env);

    // Every read reached the barrier. Under a waterfall only the first would
    // ever arrive, the barrier would never release, and this line would never
    // run — the test would time out instead.
    // Six distinct reads arrived while none had resolved. A waterfall can
    // only ever deliver one arrival, so this set is impossible sequentially.
    expect(barrier.arrived.sort()).toEqual([
      "captureFailures",
      "offerTimeline",
      "recentWatchChanges",
      "sitemapBrandEntries",
      "sitemapTimelineEntries",
      "sourceSnapshots",
    ]);
    expect(result).toBeTruthy();
  }, 15_000);

  it("degrades one failing secondary read without sinking the other four", async () => {
    // The judge edit on #2390 explicitly forbids collapsing these reads into a
    // `DB.batch()` call: batch fails as a unit, so one bad statement would
    // sink the other four. Each read keeps its own catch-and-degrade.
    const env = { DB: {} };
    installBaseMocks(env);

    const reached: string[] = [];
    const timelineRead = vi.fn().mockRejectedValue(new Error("D1 unavailable"));
    const snapshotsRead = vi.fn().mockImplementation(async () => {
      reached.push("sourceSnapshots");
      return [];
    });

    vi.doMock("~/lib/sitemap.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadIndexableBrandPageEntries: vi.fn().mockImplementation(async () => {
        reached.push("indexableAdsInternalLinks");
        return [];
      }),
    }));

    vi.doMock("~/lib/offer-timeline.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadOfferTimeline: timelineRead,
      loadDomainCaptureFailures: vi.fn().mockImplementation(async () => {
        reached.push("captureFailures");
        return [];
      }),
    }));

    vi.doMock("~/lib/ads-domain-recent-changes.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadAdsDomainRecentChanges: vi.fn().mockImplementation(async () => {
        reached.push("recentWatchChanges");
        return [];
      }),
    }));

    vi.doMock("~/components/brand-page/source-snapshots.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadBrandPageSourceSnapshots: snapshotsRead,
    }));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runLoader(env);

    // The page survived, the failing read logged its own named degrade, and
    // the other reads still ran. This is a degrade guard, not a concurrency
    // proof: it holds under a waterfall too. It is here to pin that the
    // per-read wrappers survived the Promise.all change, so a future
    // `DB.batch()` rewrite (which fails as a unit) breaks it.
    expect(result).toBeTruthy();
    expect(timelineRead).toHaveBeenCalledTimes(1);
    expect(reached).toContain("captureFailures");
    expect(reached).toContain("indexableAdsInternalLinks");
    expect(reached).toContain("recentWatchChanges");
    expect(reached).toContain("sourceSnapshots");
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages).toContain("Brand page offer timeline read failed; hiding the section.");
  }, 15_000);
});
