// @vitest-environment happy-dom

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import {
  formatSelectedAdvertiserIdentity,
  formatSelectedLandingHeadline,
  formatSelectedProofCaptureLabel,
} from "~/lib/landing-page-display";
import type { AdRecord } from "~/lib/types";

/**
 * Selected-pane evidence identity — public /search.
 *
 * The selected pane is presented as usable evidence, so every field must be
 * source-backed or an explicit, explained unavailable state. The DOM half
 * renders the real route (via the same react-router hook stub as
 * search-submission-settle) and reads the produced markup; the helper half
 * pins the pure display logic that the route delegates to.
 */

function baseAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
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
    adSnapshotUrl: "https://www.facebook.com/ads/library/?id=12345",
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    lastSeenAt: new Date().toISOString(),
    active: true,
    researchSummary: "Fixture evidence.",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  } as AdRecord;
}

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

function selectedLoaderData(ad: AdRecord): Record<string, unknown> {
  return {
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
    result: {
      ads: [ad],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: "Live ad checks are ready",
      discoveryFailureClass: null,
    },
    selectedAd: ad,
    stealSummary: null,
    selectionEnrichmentPending: false,
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
    relevanceApplied: false,
    watchedWatchlist: null,
    showOpsNav: false,
    showPresenceNav: false,
  };
}

let loaderData: Record<string, unknown>;

function mockRouter() {
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: Record<string, unknown> & { children?: ReactNode }) =>
        React.createElement("a", {
          ...props,
          href: typeof to === "string" ? to : "",
        }),
      useActionData: () => undefined,
      useLoaderData: () => loaderData,
      useLocation: () => ({ pathname: "/search", search: "", hash: "" }),
      useNavigate: () => vi.fn(),
      useNavigation: () => ({ state: "idle", location: null }),
      useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: () => ({ session: null }),
    };
  });
  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));
}

async function renderPaneMarkup() {
  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

beforeEach(() => {
  loaderData = selectedLoaderData(baseAd());
  vi.resetModules();
  mockRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("formatSelectedAdvertiserIdentity", () => {
  it("keeps the source-backed advertiser name and adds no note", () => {
    expect(formatSelectedAdvertiserIdentity("Nykaa")).toEqual({
      name: "Nykaa",
      note: null,
    });
    expect(formatSelectedAdvertiserIdentity("  Nykaa  ")).toEqual({
      name: "Nykaa",
      note: null,
    });
  });

  it("states the identity is unconfirmed instead of guessing when blank", () => {
    for (const missing of ["", "   ", null, undefined]) {
      const result = formatSelectedAdvertiserIdentity(missing);
      expect(result.name).toBe("Advertiser unconfirmed");
      expect(result.note).toContain("did not name the advertiser");
    }
  });
});

describe("formatSelectedLandingHeadline", () => {
  const captured = {
    headline: null,
    landingPageCaptured: true,
    landingPageUrl: "https://nykaa.com/festive-glow",
    enrichmentPending: false,
  };

  it("renders the source-backed headline with no unavailable note", () => {
    expect(
      formatSelectedLandingHeadline({ ...captured, headline: "Festive glow" }),
    ).toEqual({ headline: "Festive glow", note: null });
  });

  it("explains in-flight analysis while enrichment is pending", () => {
    const result = formatSelectedLandingHeadline({
      ...captured,
      enrichmentPending: true,
    });
    expect(result.headline).toBe("Analyzing creative…");
    expect(result.note).toContain("updates in a few seconds");
  });

  it("says the headline was not detected when the page was checked but blank", () => {
    const result = formatSelectedLandingHeadline(captured);
    expect(result.headline).toBe("Headline not detected");
    expect(result.note).toContain("no headline could be read");
    expect(result.note).toContain("destination link below");
  });

  it("explains the un-checked page and points at the destination link", () => {
    const result = formatSelectedLandingHeadline({
      headline: null,
      landingPageCaptured: false,
      landingPageUrl: "https://nykaa.com/festive-glow",
      enrichmentPending: false,
    });
    expect(result.headline).toBe("Landing page not checked yet");
    expect(result.note).toContain("open it to read the headline yourself");
  });

  it("explains there is no destination and offers a fresh search", () => {
    const result = formatSelectedLandingHeadline({
      headline: null,
      landingPageCaptured: false,
      landingPageUrl: null,
      enrichmentPending: false,
    });
    expect(result.headline).toBe("No destination to check");
    expect(result.note).toContain("Run a fresh search later");
  });

  it("never emits the old unexplained 'Headline not captured yet' placeholder", () => {
    const cases = [
      formatSelectedLandingHeadline(captured),
      formatSelectedLandingHeadline({ ...captured, enrichmentPending: true }),
      formatSelectedLandingHeadline({
        headline: null,
        landingPageCaptured: false,
        landingPageUrl: "https://nykaa.com/festive-glow",
        enrichmentPending: false,
      }),
      formatSelectedLandingHeadline({
        headline: null,
        landingPageCaptured: false,
        landingPageUrl: null,
        enrichmentPending: false,
      }),
    ];
    for (const result of cases) {
      expect(result.headline).not.toBe("Headline not captured yet");
    }
  });
});

describe("formatSelectedProofCaptureLabel", () => {
  const capturedAt = "2026-04-18T11:00:00.000Z";

  it("shows the capture time when the landing page was captured", () => {
    const label = formatSelectedProofCaptureLabel({
      landingPage: { capturedAt },
      landingPageUrl: "https://nykaa.com/festive-glow",
    });
    expect(label).toContain("Landing page checked");
    expect(label).toContain("Apr 18, 2026");
  });

  it("explains the un-checked page and points at the destination when a URL exists", () => {
    expect(
      formatSelectedProofCaptureLabel({
        landingPage: null,
        landingPageUrl: "https://nykaa.com/festive-glow",
      }),
    ).toBe("Landing page not checked yet — see the destination below");
  });

  it("states there is no destination when the ad carries no link", () => {
    expect(
      formatSelectedProofCaptureLabel({
        landingPage: null,
        landingPageUrl: null,
      }),
    ).toBe("No landing-page destination on this ad");
  });

  it("never emits the bare unexplained 'Landing page not captured yet' label", () => {
    expect(
      formatSelectedProofCaptureLabel({
        landingPage: null,
        landingPageUrl: "https://nykaa.com/festive-glow",
      }),
    ).not.toBe("Landing page not captured yet");
  });
});

describe("selected pane — complete evidence", () => {
  it("renders the exact source-backed advertiser, headline, URL, capture, source and freshness", async () => {
    loaderData = selectedLoaderData(
      baseAd({
        landingPage: {
          rawUrl: "https://nykaa.com/festive-glow",
          canonicalUrl: "https://nykaa.com/festive-glow",
          rawHeadline: "Festive glow is on",
          normalizedHeadline: "festive glow is on",
          normalizedHeadlineHash: "hash",
          ctaText: "Shop now",
          priceText: "Up to 40% off",
          formPresent: true,
          captureMethod: "browser_render",
          capturedAt: "2026-04-18T11:00:00.000Z",
          artifactKey: null,
        },
      }),
    );

    const markup = await renderPaneMarkup();

    expect(markup).toContain(
      '<h2 class="f9-wk-detail-name">Nykaa</h2>',
    );
    expect(markup).toContain("Festive glow is on");
    expect(markup).toContain(
      'href="https://nykaa.com/festive-glow"',
    );
    expect(markup).toContain("Landing page checked Apr 18, 2026");
    expect(markup).toContain("Source: Meta Ad Library visual check");
    expect(markup).toContain("Recent cached result");
    expect(markup).not.toContain("Advertiser unconfirmed");
    expect(markup).not.toContain("not checked yet");
    expect(markup).not.toContain("Headline not detected");
  });
});

describe("selected pane — missing advertiser identity", () => {
  it("explains the unconfirmed identity and never substitutes the query or watchlist name", async () => {
    loaderData = selectedLoaderData(baseAd({ advertiser: "" }));

    const markup = await renderPaneMarkup();

    expect(markup).toContain(
      '<h2 class="f9-wk-detail-name">Advertiser unconfirmed</h2>',
    );
    expect(markup).toContain(
      "The ad source did not name the advertiser on this ad, so we won&#x27;t guess who ran it.",
    );
    // The actionable fallback: the ad's own library link when the source
    // carried one, never the query or the watchlist display name.
    expect(markup).toContain(
      'href="https://www.facebook.com/ads/library/?id=12345"',
    );
    expect(markup).toContain("View this ad in the Meta Ad Library");
    // The pane name slot holds the honest label; the query and watchlist
    // display name are never promoted into the advertiser position.
    expect(markup).not.toContain(
      '<h2 class="f9-wk-detail-name">Nykaa</h2>',
    );
  });

  it("keeps the explanation plain when no library link exists on the ad", async () => {
    loaderData = selectedLoaderData(
      baseAd({ advertiser: "  ", adSnapshotUrl: null }),
    );

    const markup = await renderPaneMarkup();

    expect(markup).toContain("Advertiser unconfirmed");
    expect(markup).toContain(
      "The ad source did not name the advertiser on this ad",
    );
    expect(markup).not.toContain("View this ad in the Meta Ad Library");
  });
});

describe("selected pane — missing headline and landing signals", () => {
  it("shows an explained unavailable headline and keeps the destination link actionable", async () => {
    loaderData = selectedLoaderData(
      baseAd({ landingPage: null }),
    );

    const markup = await renderPaneMarkup();

    expect(markup).not.toContain("Headline not captured yet");
    expect(markup).toContain("Landing page not checked yet");
    expect(markup).toContain("open it to read the headline yourself");
    expect(markup).toContain(
      'href="https://nykaa.com/festive-glow"',
    );
    expect(markup).toContain("Page check");
    expect(markup).toContain("Not checked yet");
  });

  it("keeps signal facts explicit as Not detected, never blank", async () => {
    loaderData = selectedLoaderData(
      baseAd({
        landingPage: {
          rawUrl: "https://nykaa.com/festive-glow",
          canonicalUrl: "https://nykaa.com/festive-glow",
          rawHeadline: "Festive glow is on",
          normalizedHeadline: "festive glow is on",
          normalizedHeadlineHash: "hash",
          ctaText: null,
          priceText: null,
          formPresent: null,
          captureMethod: "landing_page_fetch",
          capturedAt: "2026-04-18T11:00:00.000Z",
          artifactKey: null,
        },
      }),
    );

    const markup = await renderPaneMarkup();

    expect(markup).toContain("Festive glow is on");
    expect(markup).toContain("Not detected");
    expect(markup).toContain("Page text checked");
  });
});

describe("selected pane — no-link and capture-unavailable", () => {
  it("shows an honest no-link state with no fabricated URL and a retry fallback", async () => {
    loaderData = selectedLoaderData(
      baseAd({ landingPageUrl: null, landingPage: null }),
    );

    const markup = await renderPaneMarkup();

    expect(markup).toContain("No destination to check");
    expect(markup).toContain("Run a fresh search later to retry the check");
    expect(markup).toContain(
      "No landing-page link was found on this ad, so there is nothing to open.",
    );
    expect(markup).toContain("No landing-page destination on this ad");
    expect(markup).not.toContain(
      'href="https://nykaa.com/festive-glow"',
    );
  });
});
