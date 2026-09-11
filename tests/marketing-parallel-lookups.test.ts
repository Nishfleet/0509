import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IndexableAdsLink } from "~/lib/ads-internal-links";
import type { PublicChangeMark } from "~/lib/public-change-mark.server";

// Issue #2951: the homepage loader used to await its two independent lookups
// (the under-fold change mark, then the indexable /ads links) one after the
// other, so the document's SSR wait was the SUM of both D1 reads. The loader
// now starts both eagerly and awaits them afterwards, so the wait is the
// SLOWEST of the two. These tests pin both halves of that contract: the two
// lookups are started before either resolves (the concurrency proof — the
// sequential code fails it), and each lookup still degrades to its own
// fallback independently (the behaviour-identical proof).

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const changeMarkSentinel: PublicChangeMark = {
  competitorLabel: "Nykaa",
  fieldLabel: "Offer / price",
  mark: { from: "10% off sitewide", to: "Free shipping over ₹499" },
  caughtAt: "2026-09-11T10:00:00.000Z",
};

const linkSentinel: IndexableAdsLink = {
  domain: "nykaa.com",
  path: "/ads/nykaa.com",
  name: "Nykaa",
};

function mockLoaderDeps(overrides: {
  loadPublicChangeMark: ReturnType<typeof vi.fn>;
  loadIndexableAdsInternalLinks: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("~/lib/public-change-mark.server", () => ({
    loadPublicChangeMark: overrides.loadPublicChangeMark,
  }));
  vi.doMock("~/lib/ads-internal-links.server", () => ({
    loadIndexableAdsInternalLinks: overrides.loadIndexableAdsInternalLinks,
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({})),
  }));
  vi.doMock("~/lib/commercial-launch-gate.server", () => ({
    publicCommercialLaunchSummary: vi.fn(() => ({
      scoutSaleOpen: false,
      starterSaleOpen: false,
      agencySaleOpen: false,
    })),
  }));
  vi.doMock("~/lib/funnel-measurement.server", () => ({
    emitFunnelHomeView: vi.fn(),
  }));
}

async function importMarketingLoader() {
  const marketing = await import("~/routes/marketing");
  return (context: unknown, request: string) =>
    marketing.loader({
      context,
      request: new Request(request),
    } as never);
}

describe("marketing homepage lookups run in parallel (issue #2951)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("starts both lookups before either resolves, then returns both results", async () => {
    const changeMarkDeferred = deferred<PublicChangeMark>();
    const linksDeferred = deferred<IndexableAdsLink[]>();
    const loadPublicChangeMark = vi.fn(() => changeMarkDeferred.promise);
    const loadIndexableAdsInternalLinks = vi.fn(() => linksDeferred.promise);
    mockLoaderDeps({ loadPublicChangeMark, loadIndexableAdsInternalLinks });

    const loader = await importMarketingLoader();
    const loaderPromise = loader({ cloudflare: { env: {} } }, "https://0509.io/");

    // Let the eager (pre-await) starts flush without resolving either
    // lookup: both mocks are called while BOTH promises are still pending.
    // Under the previous sequential awaits the second lookup was not even
    // STARTED while the first read was still pending, so this fails there.
    await vi.waitFor(
      () => {
        expect(loadPublicChangeMark).toHaveBeenCalledTimes(1);
        expect(loadIndexableAdsInternalLinks).toHaveBeenCalledTimes(1);
      },
      // The route's unmocked module imports (public-proof.server and the
      // component tree) are the slow part through the vite runner; the
      // assertion itself is timing-precise, the budget is just generosity.
      { timeout: 10_000, interval: 50 },
    );

    changeMarkDeferred.resolve(changeMarkSentinel);
    linksDeferred.resolve([linkSentinel]);
    const result = await loaderPromise;
    expect(result.changeMark).toBe(changeMarkSentinel);
    expect(result.indexableAdsLinks).toEqual([linkSentinel]);
  });

  it("a failed change-mark lookup still keeps the /ads links (independent fallbacks)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loadPublicChangeMark = vi.fn(() => Promise.reject(new Error("d1 read failed")));
    const loadIndexableAdsInternalLinks = vi.fn(() => Promise.resolve([linkSentinel]));
    mockLoaderDeps({ loadPublicChangeMark, loadIndexableAdsInternalLinks });

    const loader = await importMarketingLoader();
    const result = await loader({ cloudflare: { env: {} } }, "https://0509.io/");

    expect(result.changeMark).toBeNull();
    expect(result.indexableAdsLinks).toEqual([linkSentinel]);
    expect(warn).toHaveBeenCalledWith(
      "Homepage change mark load failed; rendering the labelled sample state.",
      { errorName: "Error" },
    );
  });

  it("a failed /ads-links lookup still keeps the change mark (independent fallbacks)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loadPublicChangeMark = vi.fn(() => Promise.resolve(changeMarkSentinel));
    const loadIndexableAdsInternalLinks = vi.fn(() => Promise.reject(new Error("d1 read failed")));
    mockLoaderDeps({ loadPublicChangeMark, loadIndexableAdsInternalLinks });

    const loader = await importMarketingLoader();
    const result = await loader({ cloudflare: { env: {} } }, "https://0509.io/");

    expect(result.changeMark).toBe(changeMarkSentinel);
    expect(result.indexableAdsLinks).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "Homepage indexable ads links load failed; omitting /ads links.",
      { errorName: "Error" },
    );
  });
});
