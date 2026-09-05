import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatAdCreativeTextValue,
  formatAdvertiserIdentityExplanation,
  formatAdvertiserLabel,
  formatAdvertiserNextStep,
  formatLandingPageCaptureStatusLabel,
  formatLandingPageHeadlineUnavailable,
  formatLandingPageNextStep,
  formatLandingPageSignalValue,
  formatLandingPageUnavailableExplanation,
} from "~/lib/landing-page-display";
import type { AdRecord, LandingPageSnapshotData } from "~/lib/types";

/**
 * Anonymous /search selected-evidence pane contract.
 *
 * A selected result is evidence: every shown value must come from the source
 * record, and every missing field must be an explicit field-specific state —
 * what was checked or not checked and what the visitor can do next — never an
 * unexplained placeholder. The helper half pins the pure display functions;
 * the render half mounts the real route with mocked react-router hooks (the
 * existing route-render style) so a dead wiring cannot pass the helper tests.
 */

const routeSource = readFileSync("app/routes/search.tsx", "utf8");

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = {
  children?: ReactNode;
  to?: string;
} & Record<string, unknown>;

const originalSearch =
  "?website=https%3A%2F%2Fnykaa.com&mode=advertiser&query=nykaa.com&country=all" +
  "&platform=Instagram&creativeType=image&status=active&trackingRole=competitor&selected=ad-1";

const fullSnapshot: LandingPageSnapshotData = {
  rawUrl: "https://nykaa.com/festive-glow",
  canonicalUrl: "https://nykaa.com/festive-glow",
  rawHeadline: "Festive glow sale",
  normalizedHeadline: "festive glow sale",
  normalizedHeadlineHash: "h-1",
  ctaText: "Shop now",
  priceText: "₹999",
  formPresent: true,
  captureMethod: "landing_page_fetch",
  capturedAt: "2026-07-10T09:30:00.000Z",
};

function baseAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Nykaa",
    body: "Festive glow sale is live for one week only.",
    previewHeadline: "Festive glow sale",
    previewSubhead: "",
    hook: "Festive glow",
    offer: "Up to 40% off",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://nykaa.com/festive-glow",
    adSnapshotUrl: "https://www.facebook.com/ads/library/?id=ad-1",
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Source-backed fixture evidence.",
    source: "meta_library_browser",
    analysisFields: [],
    landingPage: null,
    ...overrides,
  };
}

function loaderData(selectedAd: AdRecord) {
  return {
    mode: "advertiser" as const,
    filters: {
      query: "nykaa.com",
      country: "all",
      platform: "Instagram",
      creativeType: "image" as const,
      status: "active" as const,
      firstSeenFrom: "",
      lastSeenFrom: "",
    },
    fingerprint: "fp-nykaa",
    result: {
      ads: [selectedAd],
      nextCursor: null,
      source: "meta_library_browser" as const,
      provider: "meta_library_browser" as const,
      cacheStatus: "miss" as const,
      discoveryStatus: "healthy" as const,
      discoverySummary: null,
      discoveryFailureClass: null,
    },
    selectedAd,
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

async function renderSelectedPane(selectedAd: AdRecord) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(undefined),
      useLoaderData: vi.fn().mockReturnValue(loaderData(selectedAd)),
      useLocation: vi.fn().mockReturnValue({
        pathname: "/search",
        search: originalSearch,
        hash: "",
      }),
      useNavigate: vi.fn().mockReturnValue(vi.fn()),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRevalidator: vi.fn().mockReturnValue({ state: "idle", revalidate: vi.fn() }),
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

describe("selected-evidence display helpers", () => {
  it("keeps source-backed values exact", () => {
    expect(formatAdvertiserLabel("Nykaa")).toBe("Nykaa");
    expect(
      formatLandingPageCaptureStatusLabel({
        landingPageUrl: "https://nykaa.com/festive-glow",
        capturedAt: "2026-07-10T09:30:00.000Z",
      }),
    ).toMatch(/^Landing page checked /);
  });

  it("never substitutes the search term for a missing advertiser", () => {
    expect(formatAdvertiserLabel("")).toBe("Advertiser unconfirmed");
    expect(formatAdvertiserLabel(null)).toBe("Advertiser unconfirmed");
    expect(formatAdvertiserIdentityExplanation()).toContain(
      "The search term is not used as the advertiser",
    );
    expect(
      formatAdvertiserNextStep({ adSnapshotUrl: "https://fb.com/ads?id=1", landingPageUrl: null }),
    ).toBe("Open this ad in the Meta Ad Library to see who ran it.");
    expect(
      formatAdvertiserNextStep({ adSnapshotUrl: null, landingPageUrl: "https://nykaa.com" }),
    ).toBe("Open the destination to see who runs it.");
    expect(formatAdvertiserNextStep({ adSnapshotUrl: null, landingPageUrl: null })).toBe(
      "Re-run this search later — a fresh result may confirm the advertiser.",
    );
  });

  it("distinguishes a checked-but-empty headline from an unchecked page", () => {
    expect(formatLandingPageHeadlineUnavailable({ captureMethod: "browser_render" })).toBe(
      "Headline not found on the checked page.",
    );
    expect(formatLandingPageHeadlineUnavailable(null)).toBe(
      "Headline not read — the landing page was not checked for this ad.",
    );
    expect(formatLandingPageUnavailableExplanation(null)).toContain(
      "The landing page was not checked for this ad",
    );
    expect(formatLandingPageUnavailableExplanation({ captureMethod: "browser_render" })).toContain(
      "The page was checked, but no headline appeared in what was captured.",
    );
  });

  it("offers an actionable next step for every no-link and capture-unavailable combination", () => {
    expect(
      formatLandingPageNextStep({ landingPageUrl: "https://nykaa.com", adSnapshotUrl: null }),
    ).toBe("Open the destination to check the current headline and offer yourself.");
    expect(
      formatLandingPageNextStep({ landingPageUrl: null, adSnapshotUrl: "https://fb.com/ads?id=1" }),
    ).toBe("Open this ad in the Meta Ad Library to find its destination.");
    expect(formatLandingPageNextStep({ landingPageUrl: null, adSnapshotUrl: null })).toBe(
      "Re-run this search later — a fresh result may include the destination.",
    );
    expect(
      formatLandingPageCaptureStatusLabel({ landingPageUrl: "https://nykaa.com", capturedAt: null }),
    ).toBe("Landing page link found — page not checked");
    expect(
      formatLandingPageCaptureStatusLabel({ landingPageUrl: null, capturedAt: null }),
    ).toBe("No landing-page destination available");
  });

  it("keeps creative-text fact values non-blank", () => {
    expect(formatAdCreativeTextValue("Shop now")).toBe("Shop now");
    expect(formatAdCreativeTextValue("")).toBe("Not detected");
    expect(formatAdCreativeTextValue(null)).toBe("Not detected");
    expect(formatLandingPageSignalValue(null)).toBe("Not detected");
  });
});

describe("selected evidence pane render", () => {
  it("renders the exact source-backed values for complete evidence", async () => {
    const markup = await renderSelectedPane(
      baseAd({ landingPage: fullSnapshot }),
    );

    expect(markup).toContain('<h2 class="f9-wk-detail-name">Nykaa</h2>');
    expect(markup).toContain('<h4 class="f9-wk-blk-head">Festive glow sale</h4>');
    expect(markup).toContain('href="https://nykaa.com/festive-glow"');
    expect(markup).toContain("Source: Meta Ad Library visual check");
    expect(markup).toContain("Fresh result");
    expect(markup).toContain("Page text checked");
    expect(markup).toContain("Landing page checked ");
    expect(markup).not.toContain("Advertiser unconfirmed");
    expect(markup).not.toContain("Headline not read");
    expect(markup).not.toContain("No landing-page link found");
    expect(markup).not.toContain("<dd></dd>");
  });

  it("explains a missing advertiser without substituting the search query", async () => {
    const markup = await renderSelectedPane(
      baseAd({ advertiser: "", landingPageUrl: null, landingPage: null }),
    );

    expect(markup).toContain('<h2 class="f9-wk-detail-name">Advertiser unconfirmed</h2>');
    expect(markup).not.toContain('detail-name">Nykaa');
    expect(markup).not.toContain('detail-name">nykaa.com');
    expect(markup).toContain(
      "The advertiser name could not be read from this ad&#x27;s source, so none is shown.",
    );
    expect(markup).toContain("The search term is not used as the advertiser.");
    expect(markup).toContain("Open this ad in the Meta Ad Library to see who ran it.");
  });

  it("explains a missing headline with what was checked and the next step", async () => {
    const markup = await renderSelectedPane(
      baseAd({ landingPage: null }),
    );

    expect(markup).toContain(
      "Headline not read — the landing page was not checked for this ad.",
    );
    expect(markup).toContain(
      "The landing page was not checked for this ad, so no headline, offer, or CTA was read from the destination. Nothing here is guessed.",
    );
    expect(markup).toContain(
      "Open the destination to check the current headline and offer yourself.",
    );
    expect(markup).toContain("Landing page link found — page not checked");
    expect(markup).toContain("Not checked yet");
    expect(markup).not.toContain("Headline not captured yet");
    expect(markup).not.toContain("not captured yet");
    expect(markup).not.toContain("No landing-page link found");
  });

  it("says a checked page simply did not surface a headline", async () => {
    const markup = await renderSelectedPane(
      baseAd({
        landingPage: { ...fullSnapshot, rawHeadline: "", capturedAt: "2026-07-10T09:30:00.000Z" },
      }),
    );

    expect(markup).toContain("Headline not found on the checked page.");
    expect(markup).toContain(
      "The page was checked, but no headline appeared in what was captured. The other signals below come from that same check.",
    );
    expect(markup).toContain("Page text checked");
    expect(markup).toContain("Shop now");
  });

  it("renders an honest no-link state with an actionable fallback", async () => {
    const markup = await renderSelectedPane(
      baseAd({
        landingPageUrl: null,
        landingPage: { ...fullSnapshot, rawHeadline: "Persisted headline" },
      }),
    );

    expect(markup).toContain("No landing-page link found on this ad.");
    expect(markup).toContain("Open this ad in the Meta Ad Library to find its destination.");
    expect(markup).not.toContain("Re-run this search later");
  });

  it("gives one re-run step when neither link nor snapshot exists", async () => {
    const markup = await renderSelectedPane(
      baseAd({ landingPageUrl: null, adSnapshotUrl: null, landingPage: null }),
    );

    expect(markup).toContain("No landing-page link found on this ad.");
    expect(markup).toContain("No landing-page destination available");
    expect(markup).toContain("Re-run this search later — a fresh result may include the destination.");
    expect(markup.match(/Re-run this search later/g)?.length).toBe(1);
  });

  it("never renders blank fact values in the selected pane", async () => {
    const markup = await renderSelectedPane(
      baseAd({
        hook: "",
        offer: "",
        cta: "",
        languageLabel: "",
        previewHeadline: "Blank rows ad",
        landingPage: null,
      }),
    );

    expect(markup).not.toContain("<dd></dd>");
    expect(markup).toContain("Hook not detected.");
    expect(markup).toContain("No explicit offer detected");
    expect(markup).toContain("Not detected");
  });
});

describe("selected pane source guard", () => {
  it("keeps the unexplained placeholder and old capture label out of the route", () => {
    expect(routeSource).not.toContain("Headline not captured yet");
    expect(routeSource).not.toContain("not captured yet");
    expect(routeSource).not.toContain("formatProofCaptureLabel");
  });
});
