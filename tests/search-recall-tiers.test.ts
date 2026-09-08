// @vitest-environment happy-dom

// Free-preview recall dead-end guard (issue #2024, BET 2 / direction).
//
// The live observation (2026-09-08, research §1.8): on the six-brand free
// preview, allbirds (17 unverified candidates), notion (11) and oura (24)
// each returned "No verified ads found" — an empty state after a 16–25 s
// opaque `Searching…` spinner. The domain-verification post-filter (search
// v2) had fixed the okara.ai precision bug by destroying recall: a bare
// `q=<brand>` keyword search with 0 verified rows but unverified candidates
// present collapsed to the empty state instead of rendering those rows.
//
// BET 2's core promise is "the free preview never dead-ends": when >0
// unverified candidates exist but 0 verified, the result page MUST render
// those candidate rows (labelled — never blank) instead of collapsing to the
// "No verified ads found" empty state. This is the ADDITIVE rendering path:
// the verified precision guard is untouched, so the okara.ai fix cannot
// regress.
//
// This test renders the /search route over a bare-keyword result exactly like
// the live failure — 0 verified, >=1 unverified (unmatched) candidate rows —
// and asserts the candidate rows render with their tier badge and honest copy
// rather than the dead-end empty state. It guards the recall half of the
// precision/recall trade the v2 post-filter makes: precision stays intact AND
// the page is never empty when candidates exist.
//
// Already-covered-but-not-for-the-keyword-path: `streaming-three-tier` (the
// `?website=` domain path, zero verified with likely rows — that is where the
// acceptance's "likely tier + one-click 'Yes, that's them' self-confirm"
// contract is asserted) and `search-tier-labels` (backend tier assignment).
// Neither renders the bare `q=<brand>` case with ONLY unverified candidates —
// the exact dead-end that this issue files.

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord } from "~/lib/types";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

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

// A bare-keyword free-preview result with ALL candidates unmatched: the v2
// post-filter kept the rows (precision guard + additive keep) but verified 0
// and returned no likely brand-name match either — exactly the live allbirds
// shape (17 unverified candidates, "No verified ads found").
function candidateRow(
  metaAdId: string,
  advertiser: string,
): AdRecord {
  return {
    metaAdId,
    advertiser,
    body: "Shop the brand you searched for.",
    previewHeadline: "Browse the full collection",
    previewSubhead: "Fixture source evidence",
    hook: "Browse the full collection",
    offer: "New arrivals",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
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
      level: "unverified_provider_candidate",
      reason:
        "Returned for “allbirds” by the Meta source; website connection not verified",
      matchedDomain: null,
    },
  };
}

const recallLoaderData: Record<string, unknown> = {
  mode: "keyword",
  filters: {
    query: "allbirds",
    country: "all",
    platform: "all",
    creativeType: "all",
    status: "all",
    firstSeenFrom: "",
    lastSeenFrom: "",
  },
  fingerprint: "fp-allbirds",
  result: {
    ads: [
      candidateRow("meta-allbirds-1", "Allbirds Inc"),
      candidateRow("meta-allbirds-2", "Allbirds Shoebox Resellers"),
      candidateRow("meta-allbirds-3", "Sustainables Store"),
    ],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
    discoveryStatus: "healthy",
    discoverySummary: "Live ad checks are ready",
    discoveryFailureClass: null,
    verifiedCount: 0,
    likelyCount: 0,
    unmatchedCount: 3,
    rawCandidateCount: 3,
  },
  selectedAd: null,
  stealSummary: null,
  selectionEnrichmentPending: false,
  landingPageCaptureFailure: null,
  collections: [],
  plan: null,
  session: null,
  competitorWebsite: {
    raw: "",
    normalizedUrl: null,
    host: null,
    displayName: null,
    searchTerm: "",
    error: null,
  },
  trackingRole: "competitor",
  inputError: null,
  searchScope: "keyword",
  displayDomain: null,
  relevanceApplied: false,
  watchedWatchlist: null,
  showOpsNav: false,
  showPresenceNav: false,
};

async function renderMarkup() {
  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"],
  });
  revalidatorRef = { state: "idle", revalidate: vi.fn() };
  navigateMock = vi.fn();
  loaderData = recallLoaderData;
  locationObj = {
    pathname: "/search",
    search: "?q=allbirds&mode=keyword&country=all&trackingRole=competitor",
    hash: "",
  };
  navigationState = { state: "idle", location: null };
  vi.resetModules();
  mockRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe("search.recall.tiers — free preview never dead-ends with unverified candidates (issue 2024)", () => {
  it("renders candidate rows with the Unmatched badge when verifiedCount is 0 — never the bare empty state", async () => {
    const markup = await renderMarkup();

    // Every candidate row is present on the page (>=1 row, not an empty list).
    expect(markup).toContain("Allbirds Inc");
    expect(markup).toContain("Allbirds Shoebox Resellers");
    expect(markup).toContain("Sustainables Store");
    expect(markup.match(/class="f9-tier-badge is-unmatched"/g)?.length ?? 0).toBe(
      3,
    );

    // The killed-recall collapse ("No verified ads found") must never be the
    // surface for a result that carries candidate rows.
    expect(markup).not.toContain("No verified ads found");
    // The empty-state data hook is not emitted when candidates render.
    expect(markup).not.toContain("data-f9-result-empty-reason=");

    // Honest keyword half: the headline names the unverified match count
    // rather than asserting the competitor is inactive, and names a next step
    // instead of a dead-end verdict.
    expect(markup).toContain(
      "3 unverified keyword matches for &quot;allbirds&quot;",
    );
  });

  it("keeps the verified precision guard intact — a verified row still renders Verified, not a candidate label", async () => {
    // Same result, but one row resolves as a verified exact_hostname match.
    // Additive rendering must not suppress or mislabel a verified row.
    const result = recallLoaderData.result as {
      verifiedCount: number;
      likelyCount: number;
      unmatchedCount: number;
      rawCandidateCount: number;
      ads: AdRecord[];
    };
    const [firstCandidate, ...restCandidates] = result.ads;
    const adsWithVerified = [
      {
        ...firstCandidate,
        metaAdId: "meta-allbirds-verified",
        advertiser: "Allbirds, Inc.",
        landingPageUrl: "https://www.allbirds.com/shop",
        domainMatch: {
          level: "exact_hostname" as const,
          reason: "Website link match",
          matchedDomain: "www.allbirds.com",
        },
      },
      ...restCandidates,
    ];
    loaderData = {
      ...recallLoaderData,
      result: {
        ...result,
        ads: adsWithVerified,
        verifiedCount: 1,
        likelyCount: 0,
        unmatchedCount: 2,
        rawCandidateCount: 3,
      },
    };

    const markup = await renderMarkup();

    expect(markup).toContain(
      '<span class="f9-tier-badge is-verified">Verified</span>',
    );
    expect((markup.match(/class="f9-tier-badge is-unmatched"/g)?.length ?? 0)).toBe(
      2,
    );
    // Three rows, three badges — all tiers intact and none suppressed.
    expect(
      markup.match(/class="f9-tier-badge is-(verified|likely|unmatched)"/g)
        ?.length ?? 0,
    ).toBe(3);
  });
});