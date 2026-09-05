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
// vs the committed location.search, and the 90s long-horizon recovery gives
// the idle pre-search page an escape hatch (a fresh page load to the exact
// in-flight target) when that navigation cannot settle. The candidate-5
// settle probe closes the gap between "server request settled" and the 90s
// recovery: while the submit is pending on an uncommitted target, the route
// watches the browser's resource timing for the in-flight target request and
// re-issues the navigation to the exact target the moment it settles (a warm
// discovery-cache hit server-side), so the committed results render instead
// of a full grace window of "Searching…".
//
// Markup assertions use renderToStaticMarkup (the existing route-render style)
// because mounting the results row through createRoot twice in one worker
// drops Link text children under the multi-instance module mocks. The
// timer-driven recovery and revalidation tests mount for real with fake
// timers so effects run.

const TARGET_SEARCH =
  "?website=https%3A%2F%2Fnykaa.com&mode=advertiser&query=nykaa.com&trackingRole=competitor";
const ERROR_SEARCH =
  "?website=samplebrand&mode=advertiser&query=samplebrand&trackingRole=competitor";
const WARMING_SEARCH =
  "?website=https%3A%2F%2Fnykaa.com&mode=advertiser&query=nykaa.com&country=all&trackingRole=competitor&broader=1";

let loaderData: Record<string, unknown>;
let locationObj: { pathname: string; search: string; hash: string };
let navigationState: {
  state: string;
  location?: { pathname: string; search: string } | null;
};
let revalidatorRef: { state: string; revalidate: ReturnType<typeof vi.fn> };
let navigateRef: ReturnType<typeof vi.fn>;

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
      useNavigate: () => navigateRef,
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
  navigateRef = vi.fn();
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

  it("probes for a settled target request every 2 seconds while the submit is stuck", async () => {
    const { SEARCH_NAVIGATION_SETTLE_PROBE_INTERVAL_MS } = await import(
      "~/routes/search"
    );
    // Bounded and fast: far below the 90s long-horizon recovery so a settled
    // request commits results within one cadence of the browser observing it.
    expect(SEARCH_NAVIGATION_SETTLE_PROBE_INTERVAL_MS).toBe(2_000);
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
      "This search never finished loading",
    );
    expect(container.querySelector('a[href^="/search?website="]')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(container.textContent).toContain("This search never finished loading");
    expect(container.textContent).toContain(
      "It has been waiting for about a minute and a half.",
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
      "This search never finished loading",
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

  it("probes the settled-but-uncommitted target request and re-navigates to commit results instead of staying on Searching…", async () => {
    // The observed live failure: the committed page is still the idle
    // pre-search form ("Nothing searched yet"), useNavigation keeps reporting
    // loading toward the submitted target, and the target request itself has
    // settled (its response finished) without the router committing it.
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const { container, root, SearchRoute } = await mountRoute();

    expect(
      container.querySelector('button[type="submit"]')?.textContent,
    ).toContain("Searching…");
    expect(container.textContent).toContain("Nothing searched yet");
    expect(navigateRef).not.toHaveBeenCalled();

    // The target request settles: its resource timing entry appears after the
    // probe armed (the entry is the browser's record that the request ended).
    const targetEntries = [
      {
        name: `http://localhost:3000/search${TARGET_SEARCH}`,
        startTime: performance.now(),
      },
    ];
    vi.spyOn(performance, "getEntriesByType").mockReturnValue(
      targetEntries as unknown as PerformanceResourceTiming[],
    );

    // Within one probe cadence of settlement the route re-issues the
    // navigation to the EXACT in-flight target (a warm cache hit server-side).
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(navigateRef).toHaveBeenCalledTimes(1);
    expect(navigateRef).toHaveBeenCalledWith(`/search${TARGET_SEARCH}`);

    // The re-navigation commits the real loader result for the target; the
    // page renders it and the submit leaves Searching….
    loaderData = resultsLoaderData;
    locationObj = { pathname: "/search", search: TARGET_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };
    await act(async () => {
      root.render(createElement(SearchRoute));
    });

    expect(container.textContent).toContain("Festive glow");
    expect(container.textContent).not.toContain("Nothing searched yet");
    const button = container.querySelector('button[type="submit"]');
    expect(button?.textContent).toContain("See ads");
    expect(button?.hasAttribute("disabled")).toBe(false);
    expect(button?.getAttribute("aria-busy")).not.toBe("true");
    expect(container.textContent).not.toContain("Searching…");
  });

  it("renders the committed error for the settled-but-uncommitted target and re-enables submit", async () => {
    // Same settled-but-stale shape as above, but the loader's committed answer
    // for the target is an actionable validation error, not results.
    loaderData = errorLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: ERROR_SEARCH },
    };

    const { container, root, SearchRoute } = await mountRoute();

    expect(
      container.querySelector('button[type="submit"]')?.textContent,
    ).toContain("Searching…");

    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      {
        name: `http://localhost:3000/search${ERROR_SEARCH}`,
        startTime: performance.now(),
      },
    ] as unknown as PerformanceResourceTiming[]);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(navigateRef).toHaveBeenCalledTimes(1);
    expect(navigateRef).toHaveBeenCalledWith(`/search${ERROR_SEARCH}`);

    // The re-navigation commits the loader's honest error; the error renders
    // and the submit is usable again. No fabricated results anywhere.
    loaderData = errorLoaderData;
    locationObj = { pathname: "/search", search: ERROR_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };
    await act(async () => {
      root.render(createElement(SearchRoute));
    });

    expect(container.textContent).toContain(
      "That website looks incomplete. Add the full domain, like brand.com.",
    );
    expect(container.textContent).not.toContain("Festive glow");
    const button = container.querySelector('button[type="submit"]');
    expect(button?.textContent).toContain("See ads");
    expect(button?.hasAttribute("disabled")).toBe(false);
    expect(button?.getAttribute("aria-busy")).not.toBe("true");
    expect(container.textContent).not.toContain("Searching…");
  });

  it("keeps a genuinely still-pending navigation pending: no settled request, no probe", async () => {
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const { container } = await mountRoute();

    // The request is still in flight: no resource timing entry has appeared.
    await act(async () => {
      vi.advanceTimersByTime(2_000 * 20);
    });

    expect(navigateRef).not.toHaveBeenCalled();
    expect(
      container.querySelector('button[type="submit"]')?.textContent,
    ).toContain("Searching…");
    expect(container.textContent).toContain("Nothing searched yet");
  });

  it("does not treat a timing entry from before the probe armed as settlement (no false success)", async () => {
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    // The timing entry predates this navigation (e.g. the visitor once loaded
    // the same target URL directly, or a previous attempt left an entry).
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      {
        name: `http://localhost:3000/search${TARGET_SEARCH}`,
        startTime: performance.now() - 10_000,
      },
    ] as unknown as PerformanceResourceTiming[]);

    const { container } = await mountRoute();

    await act(async () => {
      vi.advanceTimersByTime(2_000 * 10);
    });

    expect(navigateRef).not.toHaveBeenCalled();
    expect(
      container.querySelector('button[type="submit"]')?.textContent,
    ).toContain("Searching…");
  });

  it("does not settle the submit from a different target's completed request (no false success)", async () => {
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    // Some other /search request settled — not the in-flight target.
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      {
        name: `http://localhost:3000/search${ERROR_SEARCH}`,
        startTime: performance.now(),
      },
    ] as unknown as PerformanceResourceTiming[]);

    const { container } = await mountRoute();

    await act(async () => {
      vi.advanceTimersByTime(2_000 * 10);
    });

    expect(navigateRef).not.toHaveBeenCalled();
    expect(
      container.querySelector('button[type="submit"]')?.textContent,
    ).toContain("Searching…");
  });

  it("probes a stuck target at most once per page, even if later requests also settle", async () => {
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const { container } = await mountRoute();

    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      {
        name: `http://localhost:3000/search${TARGET_SEARCH}`,
        startTime: performance.now(),
      },
    ] as unknown as PerformanceResourceTiming[]);

    // First settled tick: the probe fires once.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(navigateRef).toHaveBeenCalledTimes(1);

    // The navigation is still stuck in the mock (committed page unchanged), so
    // the probe interval keeps ticking — but it must not re-navigate.
    await act(async () => {
      vi.advanceTimersByTime(2_000 * 10);
    });
    expect(navigateRef).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('button[type="submit"]')?.textContent,
    ).toContain("Searching…");
  });
});
