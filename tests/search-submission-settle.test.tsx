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

  it("builds one canonical identity for a committed payload and its target URL", async () => {
    const { buildSearchIdentityFromLoaderData, buildSearchUrlIdentity } =
      await import("~/routes/search");
    type IdentityInput = Parameters<
      typeof buildSearchIdentityFromLoaderData
    >[0];
    const committedResults = buildSearchIdentityFromLoaderData(
      resultsLoaderData as unknown as IdentityInput,
    );
    const committedError = buildSearchIdentityFromLoaderData(
      errorLoaderData as unknown as IdentityInput,
    );

    // The fixture committed payloads and the in-flight target URLs describe
    // the same searches: the settled submit must recognize them as one.
    expect(committedResults).toBe(buildSearchUrlIdentity(TARGET_SEARCH));
    expect(committedError).toBe(buildSearchUrlIdentity(ERROR_SEARCH));

    // A real form-submit target carries no `query` param — the website
    // fallback derives it, so the identity still matches the committed
    // results payload.
    const SUBMIT_SHAPE_SEARCH =
      "?mode=advertiser&trackingRole=competitor&website=https%3A%2F%2Fnykaa.com&country=all&platform=all&creativeType=all&status=all&firstSeenFrom=&lastSeenFrom=";
    expect(buildSearchUrlIdentity(SUBMIT_SHAPE_SEARCH)).toBe(committedResults);

    // View-only params (selection, cursor) never change the search identity.
    expect(
      buildSearchUrlIdentity(`${TARGET_SEARCH}&selected=ad-nykaa`),
    ).toBe(buildSearchUrlIdentity(TARGET_SEARCH));
    expect(buildSearchUrlIdentity(`${TARGET_SEARCH}&after=cursor-2`)).toBe(
      buildSearchUrlIdentity(TARGET_SEARCH),
    );

    // No search committed and no search in the target: the pre-search idle
    // state is never mistaken for a settled search.
    expect(
      buildSearchIdentityFromLoaderData(
        idleLoaderData as unknown as IdentityInput,
      ),
    ).toBeNull();
    expect(buildSearchUrlIdentity("")).toBeNull();

    // Broader scope is a different search: no false settle on a filter/scope
    // change.
    expect(buildSearchUrlIdentity(WARMING_SEARCH)).not.toBe(
      buildSearchUrlIdentity(TARGET_SEARCH),
    );
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

  it("settles the submit when the committed loader data already matches the in-flight target (stale URL and loading signal, results)", async () => {
    // Observed live failure: the /search data request completed but the SPA
    // never committed the target URL and useNavigation still reported loading,
    // leaving "Searching…" over the idle page for up to 90 seconds. The
    // committed loader data IS the target's committed state — the page must
    // render it and re-enable the submit instead of stranding the visitor.
    loaderData = resultsLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: TARGET_SEARCH },
    };

    const markup = await renderMarkup();

    // The results are the committed loader data (the fixture's own ad), not a
    // fabricated success.
    expect(markup).toContain("Festive glow");
    expect(markup).toContain("See ads");
    expect(markup).not.toContain("Searching…");
    expect(markup).not.toContain('aria-busy="true"');
    expect(markup).not.toContain("disabled");
    expect(markup).not.toContain("Nothing searched yet");
  });

  it("settles the submit into the committed actionable error when the in-flight target matches stale URL and loading signals", async () => {
    loaderData = errorLoaderData;
    locationObj = { pathname: "/search", search: "", hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: ERROR_SEARCH },
    };

    const markup = await renderMarkup();

    // The committed inputError for the exact target URL, with the submit
    // released — an honest, actionable failure state.
    expect(markup).toContain(
      "That website looks incomplete. Add the full domain, like brand.com.",
    );
    expect(markup).toContain("See ads");
    expect(markup).not.toContain("Searching…");
    expect(markup).not.toContain('aria-busy="true"');
    expect(markup).not.toContain("disabled");
    expect(markup).not.toContain("Nothing searched yet");
  });

  it("keeps See ads pending for a genuinely different in-flight search (no false settle)", async () => {
    // Committed results for the exact nykaa search while a BROADER re-run of
    // the same website is loading: a different search identity, so the submit
    // must stay pending and the old committed results must not be presented
    // as the new search's own settlement.
    loaderData = resultsLoaderData;
    locationObj = { pathname: "/search", search: TARGET_SEARCH, hash: "" };
    navigationState = {
      state: "loading",
      location: { pathname: "/search", search: WARMING_SEARCH },
    };

    const markup = await renderMarkup();

    expect(markup).toContain("Searching…");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("Festive glow");
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
});
