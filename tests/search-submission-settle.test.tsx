// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Public /search submit hang: the server settles but the SPA never commits
// the target URL, so useNavigation keeps saying loading. The candidate-3 root
// cause fix derives the See ads pending state from the in-flight GET target
// vs the committed location — compared SEMANTICALLY (same query params,
// order/encoding-insensitive), so a committed URL whose serialization differs
// from the in-flight target still counts as settled. When the router never
// commits at all, a settled-request watcher reads resource timing: React
// Router 8 single-fetch SPA loader requests for /search GETs land on
// `search.data` with the target params, and once that request has settled
// (response arrived) while the router still has not committed, the recovery
// block arms after a short confirmation window instead of waiting out the
// 90-second long-horizon bound. The match is time-bounded to the current
// navigation (the entry's startTime must be at or after the idle-page epoch
// the in-flight target began from, so a pre-existing same-parameter entry can
// never arm recovery for a fresh still-pending search) and pathname-exact
// (`/search.data` and the router's trailing-slash `/search/_.data` variant,
// never any `*.data` path). The recovery block offers a fresh page load
// to the exact in-flight target and never fabricates results.
//
// Markup assertions use renderToStaticMarkup (the existing route-render style)
// because mounting the results row through createRoot twice in one worker
// drops Link text children under the multi-instance module mocks. The
// timer-driven recovery and revalidation tests mount for real with fake
// timers so effects run.

const TARGET_SEARCH =
  "?website=https%3A%2F%2Fnykaa.com&mode=advertiser&query=nykaa.com&trackingRole=competitor";
// Same query entries as TARGET_SEARCH in a different order — the committed
// location's serialization need not match the in-flight target's.
const REORDERED_TARGET_SEARCH =
  "?trackingRole=competitor&query=nykaa.com&mode=advertiser&website=https%3A%2F%2Fnykaa.com";
const ERROR_SEARCH =
  "?website=samplebrand&mode=advertiser&query=samplebrand&trackingRole=competitor";
const WARMING_SEARCH =
  "?website=https%3A%2F%2Fnykaa.com&mode=advertiser&query=nykaa.com&country=all&trackingRole=competitor&broader=1";
// React Router 8 single-fetch SPA loader requests land on `${pathname}.data`
// with the navigation's query params plus the router's own `_routes` hint.
const searchDataUrl = (search: string) =>
  `http://localhost:3000/search.data${search}&_routes=routes%2Fsearch`;

let loaderData: Record<string, unknown>;
let locationObj: { pathname: string; search: string; hash: string };
let navigationState: {
  state: string;
  location?: { pathname: string; search: string } | null;
};
let revalidatorRef: { state: string; revalidate: ReturnType<typeof vi.fn> };

function mockRouter() {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", {
          ...props,
          href: typeof to === "string" ? to : "",
        }),
      useActionData: () => undefined,
      useLoaderData: () => loaderData,
      useLocation: () => locationObj,
      useNavigate: () => vi.fn(),
      useNavigation: () => navigationState,
      useRevalidator: () => revalidatorRef,
      useRouteLoaderData: () => ({ session: null }),
    };
  });
  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));
}

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = {
  children?: ReactNode;
  to?: string;
} & Record<string, unknown>;

const idleResult = {
  ads: [],
  nextCursor: null,
  source: "demo",
  provider: "demo",
  cacheStatus: "none",
  discoveryStatus: "disabled",
  discoverySummary: null,
  discoveryFailureClass: null,
};

const idleLoaderData = {
  mode: "advertiser",
  filters: {
    query: "",
    country: "all",
    platform: "all",
    creativeType: "all",
    status: "all",
    firstSeenFrom: "",
    lastSeenFrom: "",
  },
  fingerprint: "",
  result: idleResult,
  selectedAd: null,
  stealSummary: null,
  selectionEnrichmentPending: false,
  collections: [],
  plan: null,
  session: null,
  competitorWebsite: {
    raw: "",
    normalizedUrl: null,
    host: null,
    displayName: null,
    searchTerm: null,
    error: null,
  },
  trackingRole: "competitor",
  inputError: null,
  searchScope: "exact",
  displayDomain: null,
  relevanceApplied: false,
  watchedWatchlist: null,
  showOpsNav: false,
  showPresenceNav: false,
};

const resultAd: AdRecord = {
  metaAdId: "ad-nykaa",
  advertiser: "Nykaa",
  body: "Festive glow sale is live for one week only.",
  previewHeadline: "Festive glow sale",
  previewSubhead: "Fixture source evidence",
  hook: "Festive glow",
  offer: "Up to 40% off selected beauty",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: "https://nykaa.com/festive-glow",
  adSnapshotUrl: null,
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  lastSeenAt: new Date().toISOString(),
  active: true,
  researchSummary: "Fixture evidence.",
  source: "meta_library_browser",
  analysisFields: [],
};

const resultsLoaderData: Record<string, unknown> = {
  ...idleLoaderData,
  filters: { ...idleLoaderData.filters, query: "nykaa.com" },
  fingerprint: "fp-nykaa",
  result: {
    ads: [resultAd],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
    discoveryStatus: "healthy",
    discoverySummary: "Live ad checks are ready",
    discoveryFailureClass: null,
  },
  competitorWebsite: {
    raw: "https://nykaa.com",
    normalizedUrl: "https://nykaa.com",
    host: "nykaa.com",
    displayName: "Nykaa",
    searchTerm: "nykaa.com",
    error: null,
  },
  displayDomain: "nykaa.com",
};

const errorLoaderData: Record<string, unknown> = {
  ...idleLoaderData,
  filters: { ...idleLoaderData.filters, query: "samplebrand" },
  fingerprint: "fp-samplebrand",
  competitorWebsite: {
    raw: "samplebrand",
    normalizedUrl: null,
    host: null,
    displayName: null,
    searchTerm: "samplebrand",
    error: null,
  },
  inputError: "That website looks incomplete. Add the full domain, like brand.com.",
};

const enrichmentPendingLoaderData: Record<string, unknown> = {
  ...resultsLoaderData,
  selectedAd: resultAd,
  selectionEnrichmentPending: true,
};

const warmingLoaderData: Record<string, unknown> = {
  ...idleLoaderData,
  filters: { ...idleLoaderData.filters, query: "nykaa.com" },
  fingerprint: "fp-nykaa",
  result: {
    ads: [],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    discoveryStatus: "degraded",
    discoveryProgress: "warming",
    discoverySummary:
      "Commercial discovery is already warming this query. Cached results should appear shortly.",
    discoveryFailureClass: null,
  },
  competitorWebsite: {
    raw: "https://nykaa.com",
    normalizedUrl: "https://nykaa.com",
    host: "nykaa.com",
    displayName: "Nykaa",
    searchTerm: "nykaa.com",
    error: null,
  },
  searchScope: "broader",
  displayDomain: "nykaa.com",
};

async function renderMarkup() {
  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

let cleanupRoot: Root | null = null;
let cleanupContainer: HTMLDivElement | null = null;

async function mountRoute() {
  const { default: SearchRoute } = await import("~/routes/search");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  cleanupRoot = root;
  cleanupContainer = container;
  await act(async () => {
    root.render(createElement(SearchRoute));
  });
  return { container, root, SearchRoute };
}

beforeEach(() => {
  vi.useFakeTimers();
  revalidatorRef = { state: "idle", revalidate: vi.fn() };
  loaderData = idleLoaderData;
  locationObj = { pathname: "/search", search: "", hash: "" };
  navigationState = { state: "idle", location: null };
  vi.resetModules();
  mockRouter();
});

afterEach(async () => {
  if (cleanupRoot) {
    await act(async () => cleanupRoot?.unmount());
  }
  cleanupContainer?.remove();
  cleanupRoot = null;
  cleanupContainer = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe("public search submission settle", () => {
  it("uses a 90-second (not 45) navigation settle grace window", async () => {
    const { SEARCH_NAVIGATION_SETTLE_GRACE_MS } = await import(
      "~/routes/search"
    );
    expect(SEARCH_NAVIGATION_SETTLE_GRACE_MS).toBe(90_000);
  });

  it("keeps See ads pending while a new GET navigation to /search is loading", async () => {
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const markup = await renderMarkup();

    expect(markup).toContain("Searching…");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("Nothing searched yet");
  });

  it("renders results or the error for the committed target and enables submit even when useNavigation still says loading", async () => {
    loaderData = resultsLoaderData;
    locationObj = { pathname: "/search", search: TARGET_SEARCH, hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const resultsMarkup = await renderMarkup();

    expect(resultsMarkup).toContain("Festive glow");
    expect(resultsMarkup).toContain("See ads");
    expect(resultsMarkup).not.toContain("Searching…");
    expect(resultsMarkup).not.toContain('aria-busy="true"');
    expect(resultsMarkup).not.toContain("disabled");

    loaderData = errorLoaderData;
    locationObj = { pathname: "/search", search: ERROR_SEARCH, hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: ERROR_SEARCH },
    };

    const errorMarkup = await renderMarkup();

    expect(errorMarkup).toContain(
      "That website looks incomplete. Add the full domain, like brand.com.",
    );
    expect(errorMarkup).toContain("See ads");
    expect(errorMarkup).not.toContain("Searching…");
    expect(errorMarkup).not.toContain('aria-busy="true"');
  });

  it("shows the recovery reload after 90 seconds on an uncommitted idle page, enables submit, and clears when navigation settles", async () => {
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const { container, root, SearchRoute } = await mountRoute();

    expect(container.querySelector('button[type="submit"]')?.textContent).toContain(
      "Searching…",
    );

    await act(async () => {
      vi.advanceTimersByTime(89_999);
    });
    expect(container.textContent).not.toContain(
      "This search didn't finish loading",
    );
    expect(container.querySelector('a[href^="/search?website="]')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(container.textContent).toContain("This search didn't finish loading");
    expect(container.textContent).toContain(
      "The page hasn't moved on from it yet.",
    );
    expect(container.textContent).toContain("Reload the search");
    const reloadLink = container.querySelector(
      `a[href="/search${TARGET_SEARCH}"]`,
    );
    expect(reloadLink).not.toBeNull();

    const button = container.querySelector('button[type="submit"]');
    expect(button?.textContent).toContain("See ads");
    expect(button?.hasAttribute("disabled")).toBe(false);
    expect(button?.getAttribute("aria-busy")).not.toBe("true");

    navigationState = { state: "idle", location: null };
    await act(async () => {
      root.render(createElement(SearchRoute));
    });

    expect(container.textContent).not.toContain(
      "This search didn't finish loading",
    );
    expect(container.querySelector('a[href^="/search?website="]')).toBeNull();
  });

  it("does not fire warming revalidation during loading but resumes when idle", async () => {
    loaderData = warmingLoaderData;
    locationObj = { pathname: "/search", search: WARMING_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const { root, SearchRoute } = await mountRoute();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(revalidatorRef.revalidate).toHaveBeenCalledTimes(1);

    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: WARMING_SEARCH },
    };
    await act(async () => {
      root.render(createElement(SearchRoute));
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(revalidatorRef.revalidate).toHaveBeenCalledTimes(1);

    navigationState = { state: "idle", location: null };
    await act(async () => {
      root.render(createElement(SearchRoute));
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(revalidatorRef.revalidate).toHaveBeenCalledTimes(2);
  });
  it("does not spend the one-shot enrichment revalidation while a navigation is in flight", async () => {
    // Regression: the 4s selection-enrichment revalidation is one-shot per
    // selection key. Burning the key before the navigation-idle guard spent
    // the single attempt on a skipped run, so enrichment that had already
    // finished server-side was never fetched and the creative fell back to
    // "Not detected…" with the data sitting ready.
    loaderData = enrichmentPendingLoaderData;
    locationObj = { pathname: "/search", search: TARGET_SEARCH, hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const { root, SearchRoute } = await mountRoute();

    // Navigation in flight at the 4s mark: the revalidation must be skipped...
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(revalidatorRef.revalidate).toHaveBeenCalledTimes(0);

    // ...and the one-shot must still be available once navigation settles.
    navigationState = { state: "idle", location: null };
    await act(async () => {
      root.render(createElement(SearchRoute));
    });
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(revalidatorRef.revalidate).toHaveBeenCalledTimes(1);

    // Still one-shot: it does not keep firing for the same selection key.
    await act(async () => {
      root.render(createElement(SearchRoute));
    });
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(revalidatorRef.revalidate).toHaveBeenCalledTimes(1);
  });

  it("treats a committed location carrying the same query params in a different order as settled", async () => {
    // The router committed the submitted search with a different
    // serialization (param order) than the in-flight target. The submit must
    // not stay stuck: the committed location IS the target search.
    loaderData = resultsLoaderData;
    locationObj = {
      pathname: "/search",
      search: REORDERED_TARGET_SEARCH,
      hash: "",
    };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const markup = await renderMarkup();

    expect(markup).toContain("Festive glow");
    expect(markup).toContain("See ads");
    expect(markup).not.toContain("Searching…");
    expect(markup).not.toContain('aria-busy="true"');
    expect(markup).not.toContain("disabled");
  });

  it("keeps See ads pending when the committed location is a different search", async () => {
    // No false success: a committed location with DIFFERENT query params is
    // not the in-flight target, so the submit stays pending.
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: ERROR_SEARCH, hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const markup = await renderMarkup();

    expect(markup).toContain("Searching…");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
  });

  it("arms the recovery quickly when the in-flight /search.data request has settled while the router still has not committed", async () => {
    // The observed failure: the target request settled (search.data completed
    // — the response arrived) but the router never committed, so the idle
    // page kept "Searching…" and "Nothing searched yet". Once resource
    // timing shows the target's .data request settled, the recovery must arm
    // after a short confirmation window instead of the 90s bound.
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };
    vi.stubGlobal("performance", {
      now: () => 0,
      getEntriesByType: () => [
        {
          name: searchDataUrl(TARGET_SEARCH),
          startTime: 0,
          responseEnd: 1_000,
        },
      ],
    });
    const { SEARCH_DATA_SETTLE_REARM_MS } = await import("~/routes/search");

    const { container } = await mountRoute();

    // Committed page is still the untouched idle pre-search form, and the
    // response was just observed: the recovery needs its confirmation window.
    expect(container.textContent).toContain("Nothing searched yet");
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain(
      "Searching…",
    );
    expect(container.textContent).not.toContain(
      "This search didn't finish loading",
    );

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DATA_SETTLE_REARM_MS);
    });

    expect(container.textContent).toContain("This search didn't finish loading");
    expect(container.textContent).toContain(
      "The page hasn't moved on from it yet.",
    );
    expect(container.textContent).toContain("Reload the search");
    const reloadLink = container.querySelector(
      `a[href="/search${TARGET_SEARCH}"]`,
    );
    expect(reloadLink).not.toBeNull();
    const button = container.querySelector('button[type="submit"]');
    expect(button?.textContent).toContain("See ads");
    expect(button?.hasAttribute("disabled")).toBe(false);
    expect(button?.getAttribute("aria-busy")).not.toBe("true");
  });

  it("ignores a pre-existing settled same-target entry and keeps the submit pending for the fresh search", async () => {
    // Regression: the visitor already searched this exact target before, so
    // its settled resource-timing entry (startTime BEFORE the idle-page
    // epoch) is still in the buffer. A fresh still-pending search for the
    // same target must not see that stale entry as its own settled request —
    // only the 90s long-horizon backstop bounds the fresh search.
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };
    vi.stubGlobal("performance", {
      now: () => 1_000,
      getEntriesByType: () => [
        {
          name: searchDataUrl(TARGET_SEARCH),
          startTime: 500,
          responseEnd: 1_000,
        },
      ],
    });
    const { SEARCH_DATA_SETTLE_REARM_MS, SEARCH_NAVIGATION_SETTLE_GRACE_MS } =
      await import("~/routes/search");

    const { container } = await mountRoute();

    // The stale settled entry must not arm recovery during the confirmation
    // window: the fresh search is still genuinely pending.
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DATA_SETTLE_REARM_MS);
    });
    expect(container.textContent).not.toContain(
      "This search didn't finish loading",
    );
    expect(
      container.querySelector('button[type="submit"]')?.textContent,
    ).toContain("Searching…");
    expect(
      container.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    ).toBe(true);

    // The 90s long-horizon backstop still owns the bound for the fresh
    // still-pending search.
    await act(async () => {
      vi.advanceTimersByTime(
        SEARCH_NAVIGATION_SETTLE_GRACE_MS - SEARCH_DATA_SETTLE_REARM_MS,
      );
    });
    expect(container.textContent).toContain("This search didn't finish loading");
  });

  it("arms the recovery for a settled entry that started at or after the navigation epoch", async () => {
    // Regression: a settled .data entry that started AT the idle-page epoch
    // (the moment the current in-flight target could first have begun) is the
    // CURRENT navigation's request and must trigger recovery within the
    // confirmation window — the time bound only excludes entries that
    // predate the current navigation.
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };
    vi.stubGlobal("performance", {
      now: () => 1_000,
      getEntriesByType: () => [
        {
          name: searchDataUrl(TARGET_SEARCH),
          startTime: 1_000,
          responseEnd: 2_000,
        },
      ],
    });
    const { SEARCH_DATA_SETTLE_REARM_MS } = await import("~/routes/search");

    const { container } = await mountRoute();

    expect(container.textContent).not.toContain(
      "This search didn't finish loading",
    );

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DATA_SETTLE_REARM_MS);
    });

    expect(container.textContent).toContain("This search didn't finish loading");
    const reloadLink = container.querySelector(
      `a[href="/search${TARGET_SEARCH}"]`,
    );
    expect(reloadLink).not.toBeNull();
    const button = container.querySelector('button[type="submit"]');
    expect(button?.textContent).toContain("See ads");
    expect(button?.hasAttribute("disabled")).toBe(false);
    expect(button?.getAttribute("aria-busy")).not.toBe("true");
  });

  it("keeps the submit pending while the target request has not settled, ignoring unrelated settled resources, until the long-horizon bound", async () => {
    // No false success: the target's .data request is still in flight
    // (responseEnd 0) and a settled stylesheet is unrelated — the page must
    // stay pending, and only the 90s long-horizon recovery is the bound.
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };
    vi.stubGlobal("performance", {
      now: () => 0,
      getEntriesByType: () => [
        {
          name: "http://localhost:3000/assets/app.css",
          startTime: 0,
          responseEnd: 1_000,
        },
        { name: searchDataUrl(TARGET_SEARCH), startTime: 0, responseEnd: 0 },
      ],
    });

    const { container } = await mountRoute();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain(
      "Searching…",
    );
    expect(
      container.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    ).toBe(true);
    expect(container.textContent).not.toContain(
      "This search didn't finish loading",
    );

    await act(async () => {
      vi.advanceTimersByTime(80_000);
    });
    expect(container.textContent).toContain("This search didn't finish loading");
  });

  it("sameSearchParams is order-insensitive and exact on values and counts", async () => {
    const { sameSearchParams } = await import("~/routes/search");

    expect(
      sameSearchParams(
        new URLSearchParams(TARGET_SEARCH),
        new URLSearchParams(REORDERED_TARGET_SEARCH),
      ),
    ).toBe(true);
    expect(
      sameSearchParams(new URLSearchParams("?a=1&b=2"), new URLSearchParams("?b=2&a=1")),
    ).toBe(true);
    expect(sameSearchParams(new URLSearchParams(""), new URLSearchParams(""))).toBe(
      true,
    );
    expect(sameSearchParams(new URLSearchParams("?a=1"), new URLSearchParams("?a=2"))).toBe(
      false,
    );
    expect(
      sameSearchParams(new URLSearchParams("?a=1"), new URLSearchParams("?a=1&b=2")),
    ).toBe(false);
    expect(
      sameSearchParams(new URLSearchParams("?a=1&a=1"), new URLSearchParams("?a=1")),
    ).toBe(false);
  });

  it("hasSettledSearchDataRequest matches only a settled .data request for the exact target params, started at or after the navigation epoch", async () => {
    const { hasSettledSearchDataRequest } = await import("~/routes/search");
    const epoch = 1_000;

    // The settled single-fetch loader request for the target (with the
    // router's `_routes` hint) matches when it started at the navigation
    // epoch, even when its params are reordered.
    expect(
      hasSettledSearchDataRequest(
        TARGET_SEARCH,
        [{ name: searchDataUrl(TARGET_SEARCH), startTime: epoch, responseEnd: 1_000 }],
        epoch,
      ),
    ).toBe(true);
    expect(
      hasSettledSearchDataRequest(
        REORDERED_TARGET_SEARCH,
        [{ name: searchDataUrl(TARGET_SEARCH), startTime: epoch, responseEnd: 1_000 }],
        epoch,
      ),
    ).toBe(true);
    // A request that started AFTER the navigation epoch is also the current
    // navigation's request once it has settled.
    expect(
      hasSettledSearchDataRequest(
        TARGET_SEARCH,
        [{ name: searchDataUrl(TARGET_SEARCH), startTime: epoch + 500, responseEnd: 1_000 }],
        epoch,
      ),
    ).toBe(true);
    // A settled entry that started BEFORE the navigation epoch is a
    // pre-existing entry from an earlier same-target navigation — never the
    // current one, so it cannot arm recovery.
    expect(
      hasSettledSearchDataRequest(
        TARGET_SEARCH,
        [{ name: searchDataUrl(TARGET_SEARCH), startTime: epoch - 500, responseEnd: 1_000 }],
        epoch,
      ),
    ).toBe(false);
    // A still-pending request (no response yet) is not settled.
    expect(
      hasSettledSearchDataRequest(
        TARGET_SEARCH,
        [{ name: searchDataUrl(TARGET_SEARCH), startTime: epoch, responseEnd: 0 }],
        epoch,
      ),
    ).toBe(false);
    // A settled non-.data resource is not the search request.
    expect(
      hasSettledSearchDataRequest(
        TARGET_SEARCH,
        [{ name: "http://localhost:3000/assets/app.css", startTime: epoch, responseEnd: 1_000 }],
        epoch,
      ),
    ).toBe(false);
    // A settled .data request for a different search is not this search.
    expect(
      hasSettledSearchDataRequest(
        TARGET_SEARCH,
        [{ name: searchDataUrl(ERROR_SEARCH), startTime: epoch, responseEnd: 1_000 }],
        epoch,
      ),
    ).toBe(false);
    // Only the exact single-fetch pathname shapes count: `/search.data` and
    // the documented trailing-slash variant `/search/_.data`. Any other
    // `*.data` pathname is a different request.
    expect(
      hasSettledSearchDataRequest(
        TARGET_SEARCH,
        [{ name: `http://localhost:3000/foo.data${TARGET_SEARCH}`, startTime: epoch, responseEnd: 1_000 }],
        epoch,
      ),
    ).toBe(false);
    expect(
      hasSettledSearchDataRequest(
        TARGET_SEARCH,
        [{ name: `http://localhost:3000/search.data.data${TARGET_SEARCH}`, startTime: epoch, responseEnd: 1_000 }],
        epoch,
      ),
    ).toBe(false);
    expect(
      hasSettledSearchDataRequest(
        TARGET_SEARCH,
        [{ name: `http://localhost:3000/search/_.data${TARGET_SEARCH}`, startTime: epoch, responseEnd: 1_000 }],
        epoch,
      ),
    ).toBe(true);
  });
});
