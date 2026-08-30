// @vitest-environment happy-dom

// BET 2 progressive first card (issue 1471): a cold /search must paint the
// synchronous tier the first payload already has — cached verified + likely
// rows on a warm domain, a tier-progress row ("N verified · M checking…") on a
// cold one — inside the 5s first-value budget, and keep the cold verify pass
// running in the background so the page self-updates when the full result
// lands WITHOUT a router navigation or a full document reload.
//
// The meta_library_browser provider is stubbed at the route-data channel the
// production warming revalidation feeds: tier-1 (cached) rows resolve
// synchronously in the first loader payload, and tier-2 (the live verify pass,
// ~15s in the field) is injected later through the same channel. That is the
// exact mechanism the page relies on — React Router revalidation re-runs the
// loader and the mounted route updates in place; a re-MOUNT or a navigation
// would be the failure mode this test guards against.
//
// Markup assertions use renderToStaticMarkup (the existing route-render style)
// because a second createRoot render in one worker can drop Link text children
// (see the search-submission-settle.test.tsx header comment). Timer-driven
// polling and the live update use a real happy-dom mount with fake timers.

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SEARCH =
  "?website=https%3A%2F%2Fnykaa.com&mode=advertiser&query=nykaa.com&country=all&trackingRole=competitor";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = {
  children?: ReactNode;
  to?: string;
} & Record<string, unknown>;

let loaderData: Record<string, unknown>;
let locationObj: { pathname: string; search: string; hash: string };
let navigationState: {
  state: string;
  location?: { pathname: string; search: string } | null;
};
let revalidatorRef: { state: string; revalidate: ReturnType<typeof vi.fn> };
let navigateMock: ReturnType<typeof vi.fn>;

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
      useNavigate: () => navigateMock,
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

const baseLoaderData = {
  mode: "advertiser",
  filters: {
    query: "nykaa.com",
    country: "all",
    platform: "all",
    creativeType: "all",
    status: "all",
    firstSeenFrom: "",
    lastSeenFrom: "",
  },
  fingerprint: "fp-nykaa",
  selectedAd: null,
  stealSummary: null,
  selectionEnrichmentPending: false,
  landingPageCaptureFailure: null,
  collections: [],
  plan: null,
  session: null,
  competitorWebsite: {
    raw: "https://nykaa.com",
    normalizedUrl: "https://nykaa.com",
    host: "nykaa.com",
    displayName: "Nykaa",
    searchTerm: "nykaa.com",
    error: null,
  },
  trackingRole: "competitor",
  inputError: null,
  searchScope: "exact",
  displayDomain: "nykaa.com",
  relevanceApplied: true,
  watchedWatchlist: null,
  showOpsNav: false,
  showPresenceNav: false,
};

// meta_library_browser stub payloads. `level` maps to the three-tier model
// (verified / likely / unmatched) the tier-progress row counts.
function adRow(
  metaAdId: string,
  level: "exact_hostname" | "likely_brand_name",
): AdRecord {
  return {
    metaAdId,
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
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Live Browser Run fixture",
    source: "meta_library_browser",
    analysisFields: [],
    tags: [],
    domainMatch: {
      level,
      reason:
        level === "exact_hostname"
          ? "Website link match"
          : "Advertiser name fits this brand",
      matchedDomain: level === "exact_hostname" ? "nykaa.com" : null,
    },
  };
}

// tier-1: the synchronous tier of the first payload — one cached verified row,
// the cold verify pass still running (warming + partial).
const tierOneLoaderData: Record<string, unknown> = {
  ...baseLoaderData,
  result: {
    ads: [adRow("meta-nykaa-1", "exact_hostname")],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
    discoveryStatus: "degraded",
    discoveryPartial: true,
    discoveryProgress: "warming",
    discoverySummary:
      "Showing the first ads while we load more from the Ad Library.",
    discoveryFailureClass: null,
    verifiedCount: 1,
    likelyCount: 0,
    unmatchedCount: 0,
    rawCandidateCount: 1,
  },
};

// tier-2: the complete result the background verify pass writes ~15s later.
const tierTwoLoaderData: Record<string, unknown> = {
  ...baseLoaderData,
  result: {
    ads: [
      adRow("meta-nykaa-1", "exact_hostname"),
      adRow("meta-nykaa-2", "exact_hostname"),
      adRow("meta-nykaa-3", "likely_brand_name"),
    ],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
    discoveryStatus: "healthy",
    discoverySummary: "Live ad checks are ready",
    discoveryFailureClass: null,
    verifiedCount: 2,
    likelyCount: 1,
    unmatchedCount: 0,
    rawCandidateCount: 3,
  },
};

// A genuinely cold first payload: no cached tier at all, warming only.
const coldLoaderData: Record<string, unknown> = {
  ...baseLoaderData,
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
    verifiedCount: 0,
    likelyCount: 0,
    unmatchedCount: 0,
  },
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
  // Fake ONLY the timers: Date stays real so the <5s first-paint budget is
  // measured honestly, while the ~15s tier-2 window is advanced in steps.
  vi.useFakeTimers({
    toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"],
  });
  revalidatorRef = { state: "idle", revalidate: vi.fn() };
  navigateMock = vi.fn();
  loaderData = coldLoaderData;
  locationObj = { pathname: "/search", search: SEARCH, hash: "" };
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

describe("progressive first card on /search (BET 2, issue 1471)", () => {
  it("renders a tier-progress row on a genuinely cold first payload — not a spinner-only body", async () => {
    loaderData = coldLoaderData;
    locationObj = { pathname: "/search", search: SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const { container } = await mountRoute();

    // First visible result content is the tier-progress row: the verified
    // count (0 so far), the still-checking state, and the honest promise that
    // the background pass auto-refreshes. The "Checking the Ad Library now"
    // honest-empty copy stays (substring asserted by the existing warming and
    // submission-settle suites).
    expect(container.textContent).toContain("Checking the Ad Library now");
    expect(container.textContent).toContain("0 verified · still checking");
    expect(container.textContent).toContain("Usually under a minute");
    // No undifferentiated spinner-only body and no partial-row banner (there
    // are no rows yet).
    expect(container.textContent).not.toContain("loading more");
  });

  it("paints the first verified row from the synchronous tier within 5s of mount", async () => {
    loaderData = tierOneLoaderData;
    locationObj = { pathname: "/search", search: SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const startedAt = Date.now();
    const { container } = await mountRoute();
    const mountMs = Date.now() - startedAt;

    // The tier-progress row names the tier already in the first payload:
    // 1 verified row, 0 still checking, more loading in the background.
    expect(container.textContent).toContain(
      "1 verified · 0 checking — loading more…",
    );
    // The first visible result ROW itself is painted on the first mount: its
    // link (aria-label names the ad) is in the DOM right away.
    const firstRowLink = container.querySelector('a[aria-label*="Nykaa —"]');
    expect(firstRowLink).not.toBeNull();
    expect(firstRowLink?.getAttribute("href")).toContain("selected=meta-nykaa-1");
    // The first visible result row is on the FIRST paint — the initial loader
    // data, not a revalidation round-trip — inside the 5s budget.
    expect(mountMs).toBeLessThan(5_000);
    // A synchronous tier must not need a navigation to appear.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("marks the first payload's rows with the tier-progress row copy at the markup level", async () => {
    loaderData = tierOneLoaderData;
    locationObj = { pathname: "/search", search: SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const markup = await renderMarkup();

    // Row + banner + the honest auto-refresh promise, all in the first
    // payload. Link text survives under renderToStaticMarkup, so the first
    // visible row itself is asserted here too.
    expect(markup).toContain("Nykaa");
    expect(markup).toContain("1 verified · 0 checking — loading more…");
    expect(markup).toContain("We&#x27;ll refresh automatically");
  });

  it("self-updates in place when tier-2 lands — no navigation, no document reload", async () => {
    loaderData = tierOneLoaderData;
    locationObj = { pathname: "/search", search: SEARCH, hash: "" };
    navigationState = { state: "idle", location: null };

    const { container, root, SearchRoute } = await mountRoute();
    expect(container.textContent).toContain(
      "1 verified · 0 checking — loading more…",
    );

    const mountedNodeBefore = container.firstElementChild;
    const hrefBefore = window.location.href;
    const navigationsBefore = navigateMock.mock.calls.length;
    const revalidationsBefore = revalidatorRef.revalidate.mock.calls.length;

    // ~15s elapse while the cold verify pass runs in the background. The only
    // thing that fires is the warming poll's revalidation channel — the data
    // source the page waits on. No navigation happens.
    for (let step = 0; step < 15; step += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(revalidatorRef.revalidate.mock.calls.length).toBeGreaterThan(
      revalidationsBefore,
    );
    expect(navigateMock.mock.calls.length).toBe(navigationsBefore);

    // Tier-2 lands through the same loader-data channel a revalidation uses.
    loaderData = tierTwoLoaderData;
    await act(async () => {
      root.render(createElement(SearchRoute));
    });

    // The mounted tree updated in place: the warming banner is gone and the
    // section head now names the verified tier of the COMPLETE result (2
    // verified, 1 likely — vs 1 verified on the first paint).
    expect(container.textContent).not.toContain("loading more…");
    expect(container.textContent).toContain(
      "2 verified ads linked to nykaa.com",
    );
    // The same DOM node was updated, not replaced — no full document reload.
    expect(container.firstElementChild).toBe(mountedNodeBefore);
    // No router navigation and no document-level navigation.
    expect(navigateMock.mock.calls.length).toBe(navigationsBefore);
    expect(window.location.href).toBe(hrefBefore);
  });
});