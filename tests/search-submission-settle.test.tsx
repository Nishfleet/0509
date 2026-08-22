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
// in-flight target) when that navigation cannot settle.
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

  it("idle pre-search renders honest scope copy clear of the thin-content heuristic", async () => {
    loaderData = idleLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = { state: "idle", location: null };

    const markup = await renderMarkup();

    // dogfood 694ddbd68e95: the SEO engine warns at fewer than 250 rendered
    // words. This fragment is the full body minus the prod shell's nav, so
    // its count is a strict lower bound for what the engine sees live.
    expect(markup).toContain("What a search returns");
    expect(markup).toContain("Current and recent ads");
    expect(markup).toContain("The offer, read off their landing page");
    expect(markup).toContain("The proof capture");
    expect(markup).toContain("Coverage and freshness vary by advertiser");
    const text = markup.replace(/<[^>]+>/g, " ");
    const words = text.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(250);
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

  it("suppresses the stale validation error while a re-submit navigation is in flight", async () => {
    // Committed page: the previous submission was refused with a validation
    // error, and its alert is live on the page.
    loaderData = errorLoaderData;
    locationObj = { pathname: "/search", search: ERROR_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const committedMarkup = await renderMarkup();
    expect(committedMarkup).toContain(
      "That website looks incomplete. Add the full domain, like brand.com.",
    );
    expect(committedMarkup).toContain('aria-invalid="true"');

    // The visitor corrects the website and re-submits. The GET navigation to
    // the new target is in flight but the committed page still holds the OLD
    // loader data — asserting the old error now would lie about the input
    // being searched, so the form must show the search state instead and let
    // the fresh loader result (error or results) take over on commit.
    loaderData = errorLoaderData;
    locationObj = { pathname: "/search", search: ERROR_SEARCH, hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const inFlightMarkup = await renderMarkup();

    expect(inFlightMarkup).toContain("Searching…");
    expect(inFlightMarkup).not.toContain(
      "That website looks incomplete. Add the full domain, like brand.com.",
    );
    expect(inFlightMarkup).toContain('aria-invalid="false"');
    expect(inFlightMarkup).not.toContain('role="alert"');

    // The re-submit commits a fresh error for the new input: the alert is
    // live again because it now describes the committed submission.
    loaderData = errorLoaderData;
    locationObj = { pathname: "/search", search: ERROR_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const settledMarkup = await renderMarkup();
    expect(settledMarkup).toContain(
      "That website looks incomplete. Add the full domain, like brand.com.",
    );
    expect(settledMarkup).toContain('aria-invalid="true"');
  });

  it("keeps See ads pending after the cold-path request settles while the committed page is warming", async () => {
    // Cold-path regression: the first anonymous query for an uncached
    // advertiser returns the typed warming state immediately and the browser
    // capture finishes in the background (waitUntil). The request has settled
    // (navigation idle, URL committed) but the search is still running, so the
    // submit must keep saying "Searching…" instead of flipping back to
    // "See ads" next to the in-progress line.
    loaderData = warmingLoaderData;
    locationObj = { pathname: "/search", search: WARMING_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const markup = await renderMarkup();

    expect(markup).toContain("Searching…");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("Search in progress");
  });

  it("leaves Searching… when the warming poll lands results on the committed page", async () => {
    loaderData = warmingLoaderData;
    locationObj = { pathname: "/search", search: WARMING_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const { container, root, SearchRoute } = await mountRoute();

    const pendingButton = container.querySelector('button[type="submit"]');
    expect(pendingButton?.textContent).toContain("Searching…");
    expect(pendingButton?.hasAttribute("disabled")).toBe(true);

    // The background capture lands: the next poll revalidation returns the
    // finished cache entry, and the submit leaves "Searching…".
    loaderData = resultsLoaderData;
    await act(async () => {
      root.render(createElement(SearchRoute));
    });

    const settledButton = container.querySelector('button[type="submit"]');
    expect(settledButton?.textContent).toContain("See ads");
    expect(settledButton?.hasAttribute("disabled")).toBe(false);
  });

  it("never leaves the submit disabled when a warming search does not resolve", async () => {
    // The warming pending state shares the 5s x 12 poll budget: if the
    // background capture never lands, the button re-enables after the budget
    // instead of staying on "Searching…" forever.
    loaderData = warmingLoaderData;
    locationObj = { pathname: "/search", search: WARMING_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const { container } = await mountRoute();

    const { SEARCH_WARMING_POLL_LIMIT } = await import("~/routes/search");
    // Advance in poll-sized steps so each tick's re-render can schedule the
    // next timer (a single 60s advance fires only the first tick).
    for (let step = 0; step < SEARCH_WARMING_POLL_LIMIT; step += 1) {
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
    }

    const button = container.querySelector('button[type="submit"]');
    expect(button?.textContent).toContain("See ads");
    expect(button?.hasAttribute("disabled")).toBe(false);
  });

  it("shows an honest end state when the warming check outlives the poll budget and re-arms it on retry", async () => {
    // The 5s x 12 poll budget is also the auto-refresh promise. When the
    // background capture outlives it, the page must stop claiming "we'll
    // refresh automatically": it says the check is taking longer, retracts
    // the auto-refresh, and a same-URL retry starts a fresh budget so the
    // promise is honest again for the new check.
    loaderData = warmingLoaderData;
    locationObj = { pathname: "/search", search: WARMING_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const { container, root, SearchRoute } = await mountRoute();

    expect(container.textContent).toContain("Checking the Ad Library now");
    expect(container.textContent).toContain("Usually under a minute");

    const { SEARCH_WARMING_POLL_LIMIT } = await import("~/routes/search");
    for (let step = 0; step < SEARCH_WARMING_POLL_LIMIT; step += 1) {
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
    }

    // Budget spent with the check still warming: the promised auto-refresh
    // is gone and an honest end state says what happened and what to do.
    expect(container.textContent).toContain(
      "The check is taking longer than a minute",
    );
    expect(container.textContent).toContain("We stopped auto-refreshing");
    expect(container.textContent).not.toContain("Usually under a minute");
    expect(container.textContent).not.toContain("refresh automatically");

    // Retry is a same-URL navigation: the loader runs a fresh check, and the
    // committed page must re-arm the auto-refresh promise for it.
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: WARMING_SEARCH },
    };
    await act(async () => {
      root.render(createElement(SearchRoute));
    });
    navigationState = { state: "idle", location: null };
    await act(async () => {
      root.render(createElement(SearchRoute));
    });

    expect(container.textContent).toContain("Checking the Ad Library now");
    expect(container.textContent).toContain("Usually under a minute");

    // The fresh budget polls again: the next tick fires a revalidation.
    const revalidationsBeforeRetry = revalidatorRef.revalidate.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(revalidatorRef.revalidate.mock.calls.length).toBe(
      revalidationsBeforeRetry + 1,
    );
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

  it("shows honest capture-gap copy when a selected live ad has a URL but no snapshot", async () => {
    loaderData = {
      ...resultsLoaderData,
      selectedAd: resultAd,
      selectionEnrichmentPending: false,
    };
    locationObj = { pathname: "/search", search: TARGET_SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const markup = await renderMarkup();

    expect(markup).toContain("Couldn't capture this page");
    expect(markup).toContain("Couldn't check this page");
    expect(markup).toContain("Unavailable");
    expect(markup).not.toContain("Headline not captured yet");
    expect(markup).not.toContain("Not checked yet");
  });
});

describe("refine disclosure state (BL-031 round 3)", () => {
  it("keeps the refine disclosure shut with no count on a pristine /search even when the loader geo-defaults the visitor country", async () => {
    // The loader defaults `country` to the visitor's country (cf-ipcountry),
    // so `filters.country` is non-"all" on a plain /search load with no URL
    // params. BL-031: the pre-search screen is one field and one button — the
    // disclosure must not open or print "1 on" for a filter nobody set.
    loaderData = {
      ...idleLoaderData,
      filters: { ...idleLoaderData.filters, country: "Germany" },
    };
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = { state: "idle", location: null };

    const markup = await renderMarkup();

    expect(markup).toContain("Refine search");
    expect(markup).not.toContain('f9-wk-refine" open=""');
    expect(markup).not.toContain("f9-wk-refine-n");
    expect(markup).not.toMatch(/\d+ on<\/span>/);
  });

  it("keeps the active-filter count visible once a narrowed search has actually run", async () => {
    // A committed country-scoped search is a real narrowing: the disclosure
    // opens and the summary still says how many filters are on.
    loaderData = {
      ...resultsLoaderData,
      filters: { ...(resultsLoaderData.filters as Record<string, unknown>), country: "Germany" },
    };
    locationObj = {
      pathname: "/search",
      search: "?mode=advertiser&query=nykaa.com&country=Germany",
      hash: "",
    };
    navigationState = { state: "idle", location: null };

    const markup = await renderMarkup();

    expect(markup).toContain('f9-wk-refine" open=""');
    expect(markup).toContain("f9-wk-refine-n");
    expect(markup).toContain("1 on");
  });

  it("keeps the refine disclosure shut for a broad search with no active filters", async () => {
    loaderData = {
      ...resultsLoaderData,
      filters: { ...(resultsLoaderData.filters as Record<string, unknown>), country: "all" },
    };
    locationObj = {
      pathname: "/search",
      search: "?mode=advertiser&query=nykaa.com&country=all",
      hash: "",
    };
    navigationState = { state: "idle", location: null };

    const markup = await renderMarkup();

    expect(markup).toContain("Refine search");
    expect(markup).not.toContain('f9-wk-refine" open=""');
    expect(markup).not.toContain("f9-wk-refine-n");
  });
});
