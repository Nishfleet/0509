import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatEvidenceFactValue,
  formatHeadlineEvidenceLabel,
  formatHeadlineUnavailableNote,
  formatIdentityNote,
} from "~/lib/landing-page-display";
import { formatProofCaptureLabel } from "~/lib/search-display";
import type { AdRecord, LandingPageSnapshotData, SearchResponse } from "~/lib/types";

/**
 * The anonymous /search selected-evidence pane as usable evidence.
 *
 * A selected result must show source, URL, capture state and freshness, and
 * every field either carries its source-backed value or an explicit state
 * that says what was checked or not checked and what to do next. The DOM half
 * renders the real route with the established router-mock style and reads the
 * produced markup; the helper half pins the pure display states.
 */

const route = readFileSync("app/routes/search.tsx", "utf8");

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = {
  children?: ReactNode;
  to?: string;
} & Record<string, unknown>;

let loaderData: Record<string, unknown>;

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

function landingSnapshot(
  overrides: Partial<LandingPageSnapshotData> = {},
): LandingPageSnapshotData {
  return {
    rawUrl: "https://nykaa.com/festive-glow",
    canonicalUrl: "https://nykaa.com/festive-glow",
    rawHeadline: "Festive glow sale",
    normalizedHeadline: "festive glow sale",
    normalizedHeadlineHash: "hash-1",
    captureMethod: "landing_page_fetch",
    capturedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function evidenceAd(overrides: Partial<AdRecord> = {}): AdRecord {
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
    adSnapshotUrl: null,
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

function selectedLoaderData(ad: AdRecord): Record<string, unknown> {
  const result: SearchResponse = {
    ads: [ad],
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "hit",
    discoveryStatus: "healthy",
    discoverySummary: "Live ad checks are ready",
    discoveryFailureClass: null,
  };
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
    result,
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
    relevanceApplied: true,
    watchedWatchlist: null,
    showOpsNav: false,
    showPresenceNav: false,
  };
}

async function renderPaneMarkup(ad: AdRecord) {
  loaderData = selectedLoaderData(ad);
  const { default: SearchRoute } = await import("~/routes/search");
  // renderToStaticMarkup escapes apostrophes in text; decode so copy
  // assertions read the copy, not its serialized form.
  return renderToStaticMarkup(createElement(SearchRoute)).replaceAll("&#x27;", "'");
}

beforeEach(() => {
  vi.resetModules();
  mockRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("selected pane — complete evidence", () => {
  it("renders the exact source-backed advertiser, headline, landing URL and capture metadata", async () => {
    const ad = evidenceAd({ landingPage: landingSnapshot() });
    const markup = await renderPaneMarkup(ad);

    expect(markup).toContain('<h2 class="f9-wk-detail-name">Nykaa</h2>');
    expect(markup).toContain("Festive glow sale");
    expect(markup).toContain('href="https://nykaa.com/festive-glow"');
    expect(markup).toContain("Source: Meta Ad Library visual check");
    expect(markup).toContain("Page text checked");
    expect(markup).toContain("Landing page checked");
  });

  it("shows no identity or headline explanations when the values were captured", async () => {
    const ad = evidenceAd({ landingPage: landingSnapshot() });
    const markup = await renderPaneMarkup(ad);

    expect(markup).not.toContain("The search term is not the advertiser");
    expect(markup).not.toContain("Headline unavailable");
    expect(markup).not.toContain("Headline not detected");
    expect(markup).not.toContain("wasn't read for this result");
  });
});

describe("selected pane — missing identity", () => {
  it("states the identity gap explicitly and never substitutes the search term", async () => {
    const ad = evidenceAd({
      advertiser: "",
      previewHeadline: "Festive glow sale",
      landingPage: landingSnapshot(),
    });
    const markup = await renderPaneMarkup(ad);

    expect(markup).toContain(
      '<h2 class="f9-wk-detail-name">Advertiser unconfirmed</h2>',
    );
    expect(markup).toContain(
      "We couldn't read the advertiser's name off this ad. The search term is not the advertiser.",
    );
    // The pane's name is the explicit identity state, never the search query
    // or the watchlist's inferred display name.
    expect(markup).not.toContain(
      '<h2 class="f9-wk-detail-name">Nykaa</h2>',
    );
    expect(markup).not.toContain(
      '<h2 class="f9-wk-detail-name">nykaa.com</h2>',
    );
  });
});

describe("selected pane — missing headline / landing signals", () => {
  it("shows an explicit not-read state with a next step when the page was never captured", async () => {
    const ad = evidenceAd({ landingPage: null });
    const markup = await renderPaneMarkup(ad);

    expect(markup).toContain("Headline unavailable");
    expect(markup).toContain(
      "The landing page wasn't read for this result. Open the destination yourself, or create an account to capture it on a schedule.",
    );
    // Signals and capture state stay visible and truthful.
    expect(markup).toContain("Not checked yet");
    expect(markup).toContain("Not detected");
    expect(markup).toContain("Landing page not captured yet");
    expect(markup).toContain("Recent cached result");
  });

  it("shows an explicit not-detected state when the page was checked but yielded no headline", async () => {
    const ad = evidenceAd({
      landingPage: landingSnapshot({
        rawHeadline: "",
        normalizedHeadline: "",
      }),
    });
    const markup = await renderPaneMarkup(ad);

    expect(markup).toContain("Headline not detected");
    expect(markup).toContain(
      "The landing page was checked, but no headline text was detected on it. Open the destination yourself to read what it says.",
    );
  });

  it("never renders the unexplained Headline not captured yet string", () => {
    expect(route).not.toContain("Headline not captured yet");
  });
});

describe("selected pane — no link / capture unavailable", () => {
  it("shows an honest no-link state and the capture status instead of a link", async () => {
    const ad = evidenceAd({ landingPage: null, landingPageUrl: null });
    const markup = await renderPaneMarkup(ad);

    expect(markup).toContain("No landing-page link found on this ad.");
    expect(markup).toContain("No landing-page destination available");
    expect(markup).not.toContain('href="https://nykaa.com/festive-glow"');
    expect(markup).toContain("Headline unavailable");
    expect(markup).toContain(
      "The landing page wasn't read for this result. Create an account to capture it on a schedule.",
    );
  });
});

describe("formatIdentityNote", () => {
  it("is silent while a source-backed advertiser name exists", () => {
    expect(formatIdentityNote("Nykaa")).toBeNull();
    expect(formatIdentityNote("  Nykaa  ")).toBeNull();
  });

  it("explains the gap explicitly when the advertiser is blank, without inventing one", () => {
    const note =
      "We couldn't read the advertiser's name off this ad. The search term is not the advertiser.";
    for (const blank of ["", "   ", null, undefined]) {
      expect(formatIdentityNote(blank)).toBe(note);
    }
  });
});

describe("formatHeadlineEvidenceLabel", () => {
  it("returns the source-backed headline when one was read", () => {
    expect(formatHeadlineEvidenceLabel("Festive glow sale", "landing_page_fetch", false)).toBe(
      "Festive glow sale",
    );
  });

  it("distinguishes checked-but-empty from never-read pages", () => {
    expect(formatHeadlineEvidenceLabel("", "landing_page_fetch", false)).toBe(
      "Headline not detected",
    );
    expect(formatHeadlineEvidenceLabel(null, null, false)).toBe("Headline unavailable");
    expect(formatHeadlineEvidenceLabel("", "browser_render", false)).toBe(
      "Headline not detected",
    );
  });

  it("keeps the pending analysis state explicit", () => {
    expect(formatHeadlineEvidenceLabel(null, null, true)).toBe("Analyzing creative…");
    expect(formatHeadlineEvidenceLabel("Festive glow sale", null, true)).toBe(
      "Festive glow sale",
    );
  });
});

describe("formatHeadlineUnavailableNote", () => {
  it("is silent when there is nothing to explain", () => {
    expect(formatHeadlineUnavailableNote("Headline", "landing_page_fetch", "https://x")).toBeNull();
    expect(formatHeadlineUnavailableNote(null, null, "https://x", true)).toBeNull();
  });

  it("explains a checked page that yielded no headline", () => {
    expect(formatHeadlineUnavailableNote("", "landing_page_fetch", "https://x")).toBe(
      "The landing page was checked, but no headline text was detected on it. Open the destination yourself to read what it says.",
    );
  });

  it("explains an unread page and points at the destination when one exists", () => {
    expect(formatHeadlineUnavailableNote(null, null, "https://x")).toBe(
      "The landing page wasn't read for this result. Open the destination yourself, or create an account to capture it on a schedule.",
    );
  });

  it("explains an unread page with no link and the account as the next step", () => {
    expect(formatHeadlineUnavailableNote(null, null, null)).toBe(
      "The landing page wasn't read for this result. Create an account to capture it on a schedule.",
    );
  });
});

describe("formatEvidenceFactValue", () => {
  it("renders captured values exactly and blanks as an explicit missing word", () => {
    expect(formatEvidenceFactValue("Shop now")).toBe("Shop now");
    expect(formatEvidenceFactValue("  Shop now  ")).toBe("Shop now");
    for (const blank of ["", "   ", null, undefined]) {
      expect(formatEvidenceFactValue(blank)).toBe("Not detected");
    }
  });
});

describe("formatProofCaptureLabel capture states", () => {
  it("reports the captured timestamp when the page was read", () => {
    const label = formatProofCaptureLabel(
      evidenceAd({ landingPage: landingSnapshot() }),
    );
    expect(label.startsWith("Landing page checked")).toBe(true);
    expect(label).toContain("2026");
  });

  it("states the capture gap plainly when the page was not read", () => {
    expect(formatProofCaptureLabel(evidenceAd({ landingPage: null }))).toBe(
      "Landing page not captured yet",
    );
    expect(
      formatProofCaptureLabel(evidenceAd({ landingPage: null, landingPageUrl: null })),
    ).toBe("No landing-page destination available");
  });
});
