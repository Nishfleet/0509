// @vitest-environment happy-dom

// BET 2 (issue 1482): the /search route streams results and renders every row
// with a visible three-tier badge (Verified / Likely / Unmatched), and a
// zero-verified result with candidates must NEVER dead-end on "No verified ads
// found" copy.
//
// The meta_library_browser provider is stubbed at the route-data channel the
// production warming revalidation feeds: tier-1 (cached/partial rows) resolves
// in the first payload, tier-2 (the live verify pass, ~15s in the field) is
// injected later through the same channel. That is the exact mechanism the
// page relies on — React Router revalidation re-runs the loader and the
// mounted route updates in place; a re-MOUNT or a navigation would be the
// failure mode this test guards against.
//
// (a) first card appears before the loader completes — the tier-1 payload
// paints its row inside the 5s budget while the background verify pass is
// still running (warming + partial), and the rest appends when tier-2 lands.
// (b) all three tier badges render correctly — one badge span per row with the
// tier in the `is-` class and the right word.
// (c) zero-verified non-empty state shows the likely/unmatched rows with their
// badges and an honest headline naming the tiers, never "No verified ads
// found".

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SEARCH =
  "?website=https%3A%2F%2Fnotion.so&mode=advertiser&query=notion.so&country=all&trackingRole=competitor";

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
    query: "notion.so",
    country: "all",
    platform: "all",
    creativeType: "all",
    status: "all",
    firstSeenFrom: "",
    lastSeenFrom: "",
  },
  fingerprint: "fp-notion",
  selectedAd: null,
  stealSummary: null,
  selectionEnrichmentPending: false,
  landingPageCaptureFailure: null,
  collections: [],
  plan: null,
  session: null,
  competitorWebsite: {
    raw: "https://notion.so",
    normalizedUrl: "https://notion.so",
    host: "notion.so",
    displayName: "Notion",
    searchTerm: "notion.so",
    error: null,
  },
  trackingRole: "competitor",
  inputError: null,
  searchScope: "exact",
  displayDomain: "notion.so",
  relevanceApplied: true,
  watchedWatchlist: null,
  showOpsNav: false,
  showPresenceNav: false,
};

// v2 meta_library_browser payload rows. `level` maps to the three-tier model.
// A row with a `domainMatch` object renders exactly one badge.
function adRow(
  metaAdId: string,
  level: "exact_hostname" | "likely_brand_name" | "unverified_provider_candidate",
  advertiser: string,
): AdRecord {
  return {
    metaAdId,
    advertiser,
    body: "The connected workspace where better, faster work happens.",
    previewHeadline: "One tool for your whole company",
    previewSubhead: "Fixture source evidence",
    hook: "One tool for your whole company",
    offer: "Free for students",
    cta: "Get started",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl:
      level === "exact_hostname" ? "https://notion.so/product" : null,
    adSnapshotUrl: null,
    countries: ["all"],
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
          : level === "likely_brand_name"
            ? "Advertiser name fits this brand"
            : "Returned for 'notion' by the Meta source; no brand website was searched",
      matchedDomain: level === "exact_hostname" ? "notion.so" : null,
    },
  };
}

// tier-1: a genuinely cold first payload — zero rows, warming only.
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

// tier-1 partial: the first batch landed while the verify pass still runs —
// one verified card + one likely card, warming + partial.
const firstBatchLoaderData: Record<string, unknown> = {
  ...baseLoaderData,
  result: {
    ads: [
      adRow("meta-notion-1", "exact_hostname", "Notion"),
      adRow("meta-notion-2", "likely_brand_name", "Notion"),
    ],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "partial",
    discoveryStatus: "degraded",
    discoveryProgress: "warming",
    discoveryPartial: true,
    discoverySummary:
      "Showing the first ads while we load more from the Ad Library.",
    discoveryFailureClass: null,
    verifiedCount: 1,
    likelyCount: 1,
    unmatchedCount: 0,
    rawCandidateCount: 2,
  },
};

// tier-2: the complete result. One row of each tier so all three badges are
// on the page together.
const completeLoaderData: Record<string, unknown> = {
  ...baseLoaderData,
  result: {
    ads: [
      adRow("meta-notion-1", "exact_hostname", "Notion"),
      adRow("meta-notion-2", "likely_brand_name", "Notion"),
      adRow(
        "meta-notion-3",
        "unverified_provider_candidate",
        "Notion Templates Co",
      ),
    ],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
    discoveryStatus: "healthy",
    discoverySummary: "Live ad checks are ready",
    discoveryFailureClass: null,
    verifiedCount: 1,
    likelyCount: 1,
    unmatchedCount: 1,
    rawCandidateCount: 3,
  },
};

// Zero verified but candidates exist: 1 likely + 1 unmatched row. The page
// must show the rows with their badges and an honest headline naming the
// tiers — never the "No verified ads found" dead-end copy.
const noVerifiedLoaderData: Record<string, unknown> = {
  ...baseLoaderData,
  result: {
    ads: [
      adRow("meta-notion-2", "likely_brand_name", "Notion"),
      adRow(
        "meta-notion-3",
        "unverified_provider_candidate",
        "Notion Templates Co",
      ),
    ],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
    discoveryStatus: "healthy",
    discoverySummary: "Live ad checks are ready",
    discoveryFailureClass: null,
    verifiedCount: 0,
    likelyCount: 1,
    unmatchedCount: 1,
    rawCandidateCount: 2,
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

describe("streaming three-tier on /search (BET 2, issue 1482)", () => {
  it("paints the first card from the partial batch inside the 5s budget and appends the rest when the loader completes", async () => {
    loaderData = coldLoaderData;
    const { container, root, SearchRoute } = await mountRoute();

    // Genuinely cold first payload: no rows yet, the tier-progress row is the
    // first visible result content — never a bare spinner-only body.
    expect(container.textContent).toContain("Checking the Ad Library now");
    expect(container.textContent).toContain("0 verified · still checking");

    // The partial batch lands through the same loader-data channel a
    // revalidation uses. The FIRST CARD appears here — BEFORE the loader
    // completes — with the background verify pass still running.
    const mountedNodeBefore = container.firstElementChild;
    const hrefBefore = window.location.href;
    const navigationsBefore = navigateMock.mock.calls.length;
    loaderData = firstBatchLoaderData;
    await act(async () => {
      root.render(createElement(SearchRoute));
    });

    // First card is in the DOM now, while the page still says "loading more".
    const firstCardLink = container.querySelector(
      'a[aria-label*="Notion —"]',
    );
    expect(firstCardLink).not.toBeNull();
    expect(container.textContent).toContain("1 verified · 1 checking — loading more…");
    // The first card arrived without a router navigation or document reload.
    expect(navigateMock.mock.calls.length).toBe(navigationsBefore);
    expect(window.location.href).toBe(hrefBefore);
    // Same mounted node was updated, not replaced.
    expect(container.firstElementChild).toBe(mountedNodeBefore);

    // The complete loader result lands ~15s later and the remaining rows
    // append: all three tiers are now visible.
    loaderData = completeLoaderData;
    await act(async () => {
      root.render(createElement(SearchRoute));
    });
    expect(container.textContent).not.toContain("loading more…");
    expect(container.textContent).toContain("Verified");
    expect(container.textContent).toContain("Likely");
    expect(container.textContent).toContain("Unmatched");
    expect(navigateMock.mock.calls.length).toBe(navigationsBefore);
  });

  it("renders the first card on the initial partial payload inside the 5s budget", async () => {
    loaderData = firstBatchLoaderData;
    const startedAt = Date.now();
    const { container } = await mountRoute();
    const mountMs = Date.now() - startedAt;

    expect(mountMs).toBeLessThan(5_000);
    const firstCardLink = container.querySelector(
      'a[aria-label*="Notion —"]',
    );
    expect(firstCardLink).not.toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders all three tier badges on the complete result — one badge per row, tier in the class", async () => {
    loaderData = completeLoaderData;
    const markup = await renderMarkup();

    // Each row's badge must carry its tier in the `is-` class and the word.
    expect(markup).toContain(
      '<span class="f9-tier-badge is-verified">Verified</span>',
    );
    expect(markup).toContain(
      '<span class="f9-tier-badge is-likely">Likely</span>',
    );
    expect(markup).toContain(
      '<span class="f9-tier-badge is-unmatched">Unmatched</span>',
    );
    // Exactly three badge spans for three rows, one per tier.
    const badgeCount =
      markup.match(/class="f9-tier-badge is-(verified|likely|unmatched)"/g)
        ?.length ?? 0;
    expect(badgeCount).toBe(3);

    // The honest three-tier tail under the results reflects the counts.
    expect(markup).toContain("1 verified · 1 likely · 1 unmatched");
  });

  it("shows the likely/unmatched rows with badges when verifiedCount is 0 — never the No verified ads found dead-end", async () => {
    loaderData = noVerifiedLoaderData;
    const markup = await renderMarkup();

    // Headline names the tiers instead of dead-ending.
    expect(markup).toContain(
      "No verified ads for notion.so — 1 likely match, 1 unmatched candidate",
    );
    expect(markup).not.toContain("No verified ads found for notion.so");

    // Both candidate rows render with their badges.
    expect(markup).toContain(
      '<span class="f9-tier-badge is-likely">Likely</span>',
    );
    expect(markup).toContain(
      '<span class="f9-tier-badge is-unmatched">Unmatched</span>',
    );
    expect(markup).not.toContain(
      '<span class="f9-tier-badge is-verified">Verified</span>',
    );

    // The honest explanation sentence is on the page. renderToStaticMarkup
    // HTML-encodes the apostrophe in "couldn't" to &#x27;; match the encoded form.
    expect(markup).toContain(
      "These ads matched your search but we couldn&#x27;t verify they belong to the brand",
    );

    // The three-tier tail reflects the zero-verified split.
    expect(markup).toContain("0 verified · 1 likely · 1 unmatched");
  });
});