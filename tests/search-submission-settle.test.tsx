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

  describe("settlement probe recovery", () => {
    // The observed live failure: the /search.data request settles but the SPA
    // never commits, so the committed page stays idle while the button keeps
    // "Searching…". The settlement probe asks the exact single-fetch URL the
    // router itself requested; the search pipeline serves identical in-flight
    // queries from one shared promise/D1 lease, so the probe never starts
    // duplicate provider work. A fast answer proves the target request has
    // settled; the ~12s public-search lease-wait answer is the honest "still
    // warming" state.
    const wedgeState = () => {
      loaderData = idleLoaderData;
      locationObj = { pathname: "/search", search: "", hash: "" };
      navigationState = {
        state: "loading",
        location: { pathname: "/search", search: TARGET_SEARCH },
      };
    };

    it("uses a bounded settlement probe cadence", async () => {
      const routeModule = await import("~/routes/search");
      expect(routeModule.SEARCH_SETTLE_PROBE_FIRST_DELAY_MS).toBe(5_000);
      expect(routeModule.SEARCH_SETTLE_PROBE_INTERVAL_MS).toBe(15_000);
      expect(routeModule.SEARCH_SETTLE_PROBE_FAST_MS).toBe(8_000);
      expect(routeModule.SEARCH_SETTLE_PROBE_MAX).toBe(5);
      expect(routeModule.SEARCH_SETTLE_RECOVERY_RELOAD_DELAY_MS).toBe(300);
    });

    it("recovers from a settled-but-stale navigation as soon as the target request settles, without fabricating results", async () => {
      // The server answers the target request instantly (cached result, rate
      // limit, cooldown, or input refusal — any terminal settlement).
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const assignSpy = vi.spyOn(window.location, "assign");

      wedgeState();
      const { container } = await mountRoute();

      // Before the first probe fires the navigation is still genuinely
      // pending.
      expect(
        container.querySelector('button[type="submit"]')?.textContent,
      ).toContain("Searching…");

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });

      // The probe went to the router's own single-fetch URL for the exact
      // in-flight target.
      expect(fetchMock).toHaveBeenCalledWith(
        `/search.data${TARGET_SEARCH}`,
        expect.anything(),
      );
      // The page leaves Searching… and arms the fresh-page recovery — no 90s
      // wait for a settled request. The reload anchor targets the exact
      // in-flight URL (the harness's mocked Link drops its text children on
      // later mounts, so the href is the reliable assertion).
      expect(container.textContent).toContain(
        "The search request finished, but the page didn't update",
      );
      const reloadLink = container.querySelector(
        `a[href="/search${TARGET_SEARCH}"]`,
      );
      expect(reloadLink).not.toBeNull();
      // No false success and no fabricated evidence: the recovery never
      // claims results — it hands the navigation to a fresh page load of the
      // exact target.
      expect(container.textContent).not.toContain("Festive glow");
      expect(container.textContent).not.toContain("Nykaa");
      expect(container.textContent).not.toContain(
        "This search never finished loading",
      );
      expect(container.textContent).not.toContain("about a minute and a half");
      // The submit is no longer stuck in Searching….
      const button = container.querySelector('button[type="submit"]');
      expect(button?.textContent).toContain("See ads");
      expect(button?.hasAttribute("disabled")).toBe(false);
      expect(button?.getAttribute("aria-busy")).not.toBe("true");

      // The armed recovery auto-reloads the exact in-flight target in a
      // fresh page load.
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(assignSpy).toHaveBeenCalledWith(`/search${TARGET_SEARCH}`);
    });

    it("keeps the submit pending while the target request is still warming, then recovers on settlement", async () => {
      // First probe answers like the bounded public-search lease wait (~12s,
      // the honest "still warming" state); the second answers instantly like
      // a warm cache hit once the search finishes.
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve(new Response("", { status: 200 })),
                12_000,
              );
            }),
        )
        .mockResolvedValue(new Response("", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const assignSpy = vi.spyOn(window.location, "assign");

      wedgeState();
      const { container } = await mountRoute();

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // The warming answer means the search is genuinely still running: the
      // navigation stays pending, no recovery is armed.
      await act(async () => {
        vi.advanceTimersByTime(12_000);
      });
      expect(container.textContent).not.toContain(
        "The search request finished, but the page didn't update",
      );
      expect(
        container.querySelector('button[type="submit"]')?.textContent,
      ).toContain("Searching…");
      expect(
        container.querySelector('button[type="submit"]')?.hasAttribute(
          "disabled",
        ),
      ).toBe(true);

      // The next probe settles with the committed outcome: recovery arms and
      // the submit un-sticks.
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain(
        "The search request finished, but the page didn't update",
      );
      const button = container.querySelector('button[type="submit"]');
      expect(button?.textContent).toContain("See ads");
      expect(button?.hasAttribute("disabled")).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(assignSpy).toHaveBeenCalledWith(`/search${TARGET_SEARCH}`);
    });

    it("keeps pending through the probe budget and still reaches the 90s long-horizon recovery", async () => {
      // The server never settles the target request: every probe answers with
      // the warming state.
      const fetchMock = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve(new Response("", { status: 200 })),
                12_000,
              );
            }),
        );
      vi.stubGlobal("fetch", fetchMock);

      wedgeState();
      const { container } = await mountRoute();

      await act(async () => {
        vi.advanceTimersByTime(89_999);
      });
      // No settlement recovery and no long-horizon recovery yet.
      expect(container.textContent).not.toContain(
        "The search request finished, but the page didn't update",
      );
      expect(container.textContent).not.toContain(
        "This search never finished loading",
      );
      expect(
        container.querySelector('button[type="submit"]')?.textContent,
      ).toContain("Searching…");

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      // The bounded long-horizon recovery remains the terminal backstop.
      expect(container.textContent).toContain(
        "This search never finished loading",
      );
      expect(container.textContent).toContain("about a minute and a half");
      const button = container.querySelector('button[type="submit"]');
      expect(button?.textContent).toContain("See ads");
      expect(button?.hasAttribute("disabled")).toBe(false);
    });

    it("does not arm any recovery when the navigation commits normally", async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve(new Response("", { status: 200 })),
                12_000,
              );
            }),
        );
      vi.stubGlobal("fetch", fetchMock);

      wedgeState();
      const { container, root, SearchRoute } = await mountRoute();

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      await act(async () => {
        vi.advanceTimersByTime(12_000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // The router commits the target results before the next probe.
      loaderData = resultsLoaderData;
      locationObj = { pathname: "/search", search: TARGET_SEARCH, hash: "" };
      navigationState = { state: "idle", location: null };
      await act(async () => {
        root.render(createElement(SearchRoute));
      });

      expect(container.textContent).toContain("Festive glow");
      expect(container.textContent).not.toContain(
        "The search request finished, but the page didn't update",
      );
      expect(container.textContent).not.toContain(
        "This search never finished loading",
      );
      // No further probes once the navigation commits.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
