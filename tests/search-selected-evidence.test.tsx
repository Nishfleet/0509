import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatSearchAdvertiserUnavailableNote,
  formatSearchCtaLabel,
  formatSearchLandingHeadlineUnavailableNote,
  hasSearchAdvertiserIdentity,
  hasSearchLandingHeadline,
} from "~/lib/landing-page-display";
import type {
  AdRecord,
  LandingPageSnapshotData,
} from "~/lib/types";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = {
  children?: ReactNode;
  to?: string;
} & Record<string, unknown>;

// The anonymous /search evidence pane must stay decision-ready: a selected
// result renders its source-backed values exactly, and a field that is truly
// unavailable gets an explicit explanation of what was (or was not) checked
// plus a concrete next step — never a bare placeholder and never the search
// query substituted for the advertiser. Markup assertions use the existing
// route-render style (renderToStaticMarkup of SearchRoute with react-router
// mocked), and the pure display helpers are asserted directly.

function baseAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
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

function landingSnapshot(
  overrides: Partial<LandingPageSnapshotData> = {},
): LandingPageSnapshotData {
  return {
    rawUrl: "https://nykaa.com/festive-glow",
    canonicalUrl: "https://nykaa.com/festive-glow",
    rawHeadline: "Glow Serum Sale",
    normalizedHeadline: "Glow Serum Sale",
    normalizedHeadlineHash: "h-1",
    ctaText: "Shop now",
    priceText: "₹499",
    formPresent: false,
    captureMethod: "landing_page_fetch",
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

function loaderData(ad: AdRecord) {
  return {
    mode: "advertiser" as const,
    filters: {
      query: "nykaa.com",
      country: "all",
      platform: "all",
      creativeType: "all" as const,
      status: "all" as const,
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
    fingerprint: "fp-nykaa",
    result: {
      ads: [ad],
      nextCursor: null,
      source: "meta_library_browser" as const,
      provider: "meta_library_browser" as const,
      cacheStatus: "miss" as const,
      discoveryStatus: "healthy" as const,
      discoveryFailureClass: null,
    },
    selectedAd: ad,
    collections: [],
    session: null,
    competitorWebsite: {
      raw: "https://nykaa.com",
      normalizedUrl: "https://nykaa.com",
      host: "nykaa.com",
      displayName: "Nykaa",
      searchTerm: "nykaa.com",
      error: null,
    },
    trackingRole: "competitor" as const,
    inputError: null,
    searchScope: "exact" as const,
    displayDomain: "nykaa.com",
    showOpsNav: false,
    showPresenceNav: false,
  };
}

async function renderSelectedEvidence(ad: AdRecord) {
  const search =
    "?website=https%3A%2F%2Fnykaa.com&mode=advertiser&query=nykaa.com" +
    "&trackingRole=competitor&selected=ad-1";

  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(loaderData(ad)),
      useLocation: vi
        .fn()
        .mockReturnValue({ pathname: "/search", search, hash: "" }),
      useNavigate: vi.fn().mockReturnValue(vi.fn()),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRevalidator: vi
        .fn()
        .mockReturnValue({ state: "idle", revalidate: vi.fn() }),
      useRouteLoaderData: vi.fn().mockReturnValue({ session: null }),
    };
  });

  vi.doMock("~/components/dashboard-shell", () => ({
    DashboardShell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  }));

  const { default: SearchRoute } = await import("~/routes/search");
  return renderToStaticMarkup(createElement(SearchRoute));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("search selected evidence — complete capture", () => {
  it("renders the exact source-backed advertiser, headline, URL, and capture metadata", async () => {
    const markup = await renderSelectedEvidence(
      baseAd({ landingPage: landingSnapshot() }),
    );

    expect(markup).toContain(
      '<h2 class="f9-wk-detail-name">Nykaa</h2>',
    );
    expect(markup).toContain("Glow Serum Sale");
    expect(markup).toContain(
      'href="https://nykaa.com/festive-glow"',
    );
    expect(markup).toContain("Page text checked");
    expect(markup).toContain("Landing page checked");
    expect(markup).toContain("Source: Meta Ad Library visual check");
    expect(markup).toContain("Fresh result");
    expect(markup).not.toContain("Headline unavailable");
    expect(markup).not.toContain("advertiser name couldn't be read");
  });
});

describe("search selected evidence — missing identity", () => {
  it("explains the missing advertiser instead of substituting the search query", async () => {
    const markup = await renderSelectedEvidence(
      baseAd({ advertiser: "", landingPage: landingSnapshot() }),
    );

    expect(markup).toContain(
      '<h2 class="f9-wk-detail-name">Advertiser unconfirmed</h2>',
    );
    expect(markup).toContain(
      "The advertiser name couldn&#x27;t be read from the Meta Ad Library card.",
    );
    expect(markup).toContain("We never guess it from your search");
    expect(markup).toContain(
      "open the destination link below to confirm who is running this ad",
    );
    expect(markup).not.toContain(
      '<h2 class="f9-wk-detail-name">nykaa.com</h2>',
    );
    expect(markup).not.toContain(
      '<h2 class="f9-wk-detail-name">Nykaa</h2>',
    );
  });

  it("keeps the identity explanation actionable when no destination link exists", async () => {
    const markup = await renderSelectedEvidence(
      baseAd({
        advertiser: "   ",
        landingPageUrl: null,
        landingPage: null,
      }),
    );

    expect(markup).toContain("Advertiser unconfirmed");
    expect(markup).toContain(
      "search a line of the ad copy above in the Meta Ad Library to confirm who is running it",
    );
  });
});

describe("search selected evidence — missing headline", () => {
  it("replaces 'Headline not captured yet' with an explained state and a link to check", async () => {
    const markup = await renderSelectedEvidence(
      baseAd({ landingPage: null }),
    );

    expect(markup).toContain("Headline unavailable");
    expect(markup).toContain(
      "This destination hasn&#x27;t been read — open the link below to see the headline yourself.",
    );
    expect(markup).toContain("Not checked yet");
    expect(markup).toContain(
      'href="https://nykaa.com/festive-glow"',
    );
    expect(markup).not.toContain("Headline not captured yet");
  });

  it("distinguishes a page that was checked but yielded no headline", async () => {
    const markup = await renderSelectedEvidence(
      baseAd({
        landingPage: landingSnapshot({ rawHeadline: "" }),
      }),
    );

    expect(markup).toContain("Headline unavailable");
    expect(markup).toContain(
      "We checked this page and couldn&#x27;t read a headline from it. Open the destination link below to see the current headline.",
    );
    expect(markup).not.toContain("Headline not captured yet");
  });
});

describe("search selected evidence — no link and capture unavailable", () => {
  it("shows an honest no-link state, explains the missing capture, and invents no URL", async () => {
    const markup = await renderSelectedEvidence(
      baseAd({
        advertiser: "",
        landingPageUrl: null,
        landingPage: null,
      }),
    );

    expect(markup).toContain("No landing-page link found on this ad.");
    expect(markup).toContain(
      "This ad didn&#x27;t surface a destination link, so there was no page to read a headline from.",
    );
    expect(markup).toContain("No landing-page destination available");
    expect(markup).not.toContain("Headline not captured yet");
    expect(markup).not.toContain('class="f9-wk-url"');
  });
});

describe("search selected evidence — no blank definitions", () => {
  it("renders honest fallbacks for blank hook, CTA, and language rows", async () => {
    const markup = await renderSelectedEvidence(
      baseAd({
        hook: "",
        cta: "",
        languageLabel: "",
        landingPage: null,
      }),
    );

    expect(markup).toContain("Hook not detected.");
    expect(markup).toContain("CTA not detected");
    expect(markup).toContain("Language unavailable");
  });
});

describe("search selected evidence — display helpers", () => {
  it("hasSearchAdvertiserIdentity accepts only a real name", () => {
    expect(hasSearchAdvertiserIdentity("Nykaa")).toBe(true);
    expect(hasSearchAdvertiserIdentity("  Nykaa  ")).toBe(true);
    expect(hasSearchAdvertiserIdentity("")).toBe(false);
    expect(hasSearchAdvertiserIdentity("   ")).toBe(false);
    expect(hasSearchAdvertiserIdentity(null)).toBe(false);
    expect(hasSearchAdvertiserIdentity(undefined)).toBe(false);
  });

  it("formatSearchAdvertiserUnavailableNote points at the destination when one exists", () => {
    const note = formatSearchAdvertiserUnavailableNote({
      hasDestination: true,
    });
    expect(note).toContain("We never guess it from your search");
    expect(note).toContain("open the destination link below");
  });

  it("formatSearchAdvertiserUnavailableNote falls back to the ad copy when there is no link", () => {
    const note = formatSearchAdvertiserUnavailableNote({
      hasDestination: false,
    });
    expect(note).toContain("We never guess it from your search");
    expect(note).toContain("search a line of the ad copy above");
    expect(note).not.toContain("open the destination link below");
  });

  it("hasSearchLandingHeadline accepts only a real headline", () => {
    expect(hasSearchLandingHeadline(landingSnapshot())).toBe(true);
    expect(hasSearchLandingHeadline(landingSnapshot({ rawHeadline: "  " }))).toBe(
      false,
    );
    expect(hasSearchLandingHeadline(null)).toBe(false);
    expect(hasSearchLandingHeadline(undefined)).toBe(false);
  });

  it("formatSearchLandingHeadlineUnavailableNote explains each capture state", () => {
    expect(
      formatSearchLandingHeadlineUnavailableNote({
        captureMethod: "landing_page_fetch",
        hasDestination: true,
      }),
    ).toBe(
      "We checked this page and couldn't read a headline from it. Open the destination link below to see the current headline.",
    );
    expect(
      formatSearchLandingHeadlineUnavailableNote({
        captureMethod: null,
        hasDestination: true,
      }),
    ).toBe(
      "This destination hasn't been read — open the link below to see the headline yourself.",
    );
    expect(
      formatSearchLandingHeadlineUnavailableNote({
        captureMethod: null,
        hasDestination: false,
      }),
    ).toContain("no page to read a headline from");
  });

  it("formatSearchCtaLabel keeps a real CTA and states a missing one", () => {
    expect(formatSearchCtaLabel("Shop now")).toBe("Shop now");
    expect(formatSearchCtaLabel("  Shop now  ")).toBe("Shop now");
    expect(formatSearchCtaLabel("")).toBe("CTA not detected");
    expect(formatSearchCtaLabel(null)).toBe("CTA not detected");
    expect(formatSearchCtaLabel(undefined)).toBe("CTA not detected");
  });
});
