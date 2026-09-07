import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord, LandingPageSnapshotData } from "~/lib/types";
import fixtures from "./e2e/search-landing-page-capture.fixtures.json";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type AdvertiserFixture = (typeof fixtures)[number];

let loaderData: Record<string, unknown>;
let locationSearch = "";

function mockRouter() {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: () => undefined,
      useLoaderData: () => loaderData,
      useLocation: () => ({ pathname: "/search", search: locationSearch, hash: "" }),
      useNavigate: () => vi.fn(),
      useNavigation: () => ({ state: "idle" }),
      useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: () => ({ session: null }),
    };
  });
  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));
}

function landingPageFor(fixture: AdvertiserFixture): LandingPageSnapshotData {
  return {
    rawUrl: fixture.landingPageUrl,
    canonicalUrl: fixture.landingPageUrl,
    rawHeadline: fixture.rawHeadline,
    normalizedHeadline: fixture.rawHeadline.toLowerCase(),
    normalizedHeadlineHash: fixture.query,
    ctaText: fixture.ctaText,
    priceText: fixture.priceText,
    formPresent: fixture.formPresent,
    captureMethod: "landing_page_fetch",
    capturedAt: "2026-08-26T12:00:00.000Z",
  };
}

function adFor(fixture: AdvertiserFixture, snapshot: LandingPageSnapshotData | null): AdRecord {
  return {
    metaAdId: `ad-${fixture.query}`,
    advertiser: fixture.advertiser,
    body: `${fixture.advertiser} campaign`,
    previewHeadline: fixture.rawHeadline,
    previewSubhead: fixture.advertiser,
    hook: fixture.rawHeadline,
    offer: fixture.priceText,
    cta: fixture.ctaText,
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: fixture.landingPageUrl,
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: "2026-08-20T00:00:00.000Z",
    lastSeenAt: "2026-08-26T00:00:00.000Z",
    active: true,
    researchSummary: "Fixture evidence.",
    source: "meta_library_browser",
    analysisFields: [],
    landingPage: snapshot,
  };
}

function loaderFor(fixture: AdvertiserFixture, snapshot: LandingPageSnapshotData | null, failureReason?: string) {
  const selectedAd = adFor(fixture, snapshot);
  return {
    mode: "advertiser" as const,
    filters: {
      query: fixture.query,
      country: "all",
      platform: "all",
      creativeType: "all" as const,
      status: "all" as const,
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
    fingerprint: `fp-${fixture.query}-all`,
    result: {
      ads: [selectedAd],
      nextCursor: null,
      source: "meta_library_browser",
      provider: "meta_library_browser",
      cacheStatus: "hit",
      discoveryStatus: "healthy",
      discoverySummary: "Live ad checks are ready",
      discoveryFailureClass: null,
    },
    selectedAd,
    resultCaptureAgeLabel: null,
    stealSummary: null,
    selectionEnrichmentPending: false,
    landingPageCaptureFailure: failureReason
      ? { reasonCode: failureReason, metadata: {} }
      : null,
    collections: [],
    plan: null,
    session: null,
    competitorWebsite: {
      raw: fixture.query,
      normalizedUrl: null,
      host: null,
      displayName: fixture.advertiser,
      searchTerm: fixture.query,
      error: null,
    },
    trackingRole: "competitor" as const,
    inputError: null,
    searchScope: "exact" as const,
    displayDomain: null,
    relevanceApplied: false,
    watchedWatchlist: null,
    showOpsNav: false,
    showPresenceNav: false,
  };
}

async function renderSearch(): Promise<string> {
  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

function landingBlock(markup: string) {
  const match = markup.match(/Landing page[\s\S]*?<\/section>|f9-wk-kick">Landing page[\s\S]*?f9-wk-url/);
  return match?.[0] ?? markup;
}

beforeEach(() => {
  vi.resetModules();
  mockRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("search detail pane landing-page capture", () => {
  it.each(fixtures)(
    "$query shows a captured landing-page fact, not the unavailable dead end",
    async (fixture) => {
      loaderData = loaderFor(fixture, landingPageFor(fixture));
      locationSearch = `?q=${fixture.query}&country=all`;

      const markup = await renderSearch();
      const text = landingBlock(markup).replace(/&#x27;/g, "'");

      expect(text).toContain("Landing page");
      expect(text).toContain(fixture.rawHeadline);
      expect(text).toContain("Primary CTA");
      expect(text).toContain(fixture.ctaText);
      expect(text).toContain("Visible price/offer");
      expect(text).toContain(fixture.priceText);
      expect(text).toContain("Form present");
      expect(text).toContain(fixture.formPresent ? "Yes" : "No");
      expect(text).not.toContain("Unavailable");
      expect(text).not.toContain("Couldn't capture this page");
      expect(text).not.toContain("Landing page not captured yet");
    },
  );

  it("names a blocked page and a next step instead of Couldn’t capture this page", async () => {
    const fixture = fixtures[0];
    loaderData = loaderFor(fixture, null, "landing_blocked");
    locationSearch = `?q=${fixture.query}&country=all`;

    const markup = await renderSearch();
    const text = landingBlock(markup).replace(/&#x27;/g, "'");

    expect(text).toContain("This page blocked the automated check");
    expect(text).toContain("Open the landing-page link below to read the offer yourself.");
    expect(text).toContain("Blocked by the site");
    expect(text).not.toContain("Couldn't capture this page");
    expect(text).not.toContain("Landing page not captured yet");
    expect(text).not.toContain(">Unavailable<");
  });
});
