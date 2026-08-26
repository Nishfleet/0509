import { afterEach, describe, expect, it } from "vitest";

import {
  formatAdDetailBody,
  formatProofCaptureLabel,
  formatResultCardSummary,
  formatSearchCaptureAgeLabel,
  formatSearchCommandTitle,
  formatSearchMarketScope,
  formatSelectedLandingFactValue,
  formatSelectedLandingHeadline,
} from "~/lib/search-display";
import type { AdRecord } from "~/lib/types";

const originalTimezone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimezone;
});

function adWithCapture(capturedAt: string, landingPageUrl = "https://example.com") {
  return {
    landingPageUrl,
    landingPage: { capturedAt },
  } as AdRecord;
}

describe("formatProofCaptureLabel", () => {
  it("renders the capture instant pinned to en-GB UTC whatever the runtime timezone is", () => {
    // The regression: toLocaleString(undefined, …) uses the runtime default
    // locale and timezone, so SSR (UTC) and the visitor's browser (their
    // local zone) rendered different strings and React hydration failed.
    // The label must be byte-identical across any server/client timezone.
    for (const timeZone of [
      "UTC",
      "Asia/Kolkata",
      "Pacific/Kiritimati",
      "America/New_York",
    ]) {
      process.env.TZ = timeZone;
      expect(formatProofCaptureLabel(adWithCapture("2026-03-28T09:00:00.000Z"))).toBe(
        "Landing page checked 28 Mar 2026, 09:00 UTC",
      );
    }
  });

  it("pins the locale (en-GB, 24h) rather than the runtime default", () => {
    process.env.TZ = "America/New_York";
    // en-US would render "Mar 28, 2026, 5:00 AM"; the pinned en-GB output is
    // the contract between server and client.
    expect(formatProofCaptureLabel(adWithCapture("2026-03-28T09:00:00.000Z"))).toBe(
      "Landing page checked 28 Mar 2026, 09:00 UTC",
    );
  });

  it("falls back to the not-captured label when capturedAt is missing or invalid", () => {
    expect(formatProofCaptureLabel(adWithCapture("not-a-date"))).toBe(
      "Landing page not captured yet",
    );
    expect(
      formatProofCaptureLabel({
        landingPageUrl: "https://example.com",
        landingPage: null,
      } as AdRecord),
    ).toBe("Landing page not captured yet");
  });

  it("falls back to the no-destination label when there is no landing-page URL", () => {
    expect(formatProofCaptureLabel({ landingPageUrl: null } as AdRecord)).toBe(
      "No landing-page destination available",
    );
  });
});

describe("formatSelectedLandingHeadline", () => {
  it("returns the captured headline when present", () => {
    expect(
      formatSelectedLandingHeadline({
        rawHeadline: "  Festive glow  ",
        landingPageUrl: "https://example.com",
        hasLandingPage: true,
        pending: false,
      }),
    ).toBe("Festive glow");
  });

  it("returns Analyzing creative… while enrichment is in flight", () => {
    expect(
      formatSelectedLandingHeadline({
        rawHeadline: null,
        landingPageUrl: "https://example.com",
        hasLandingPage: false,
        pending: true,
      }),
    ).toBe("Analyzing creative…");
  });

  it("returns Couldn't capture this page when a URL exists without a snapshot", () => {
    expect(
      formatSelectedLandingHeadline({
        rawHeadline: null,
        landingPageUrl: "https://example.com",
        hasLandingPage: false,
        pending: false,
      }),
    ).toBe("Couldn't capture this page");
  });

  it("returns Headline not captured yet when there is no landing-page URL", () => {
    expect(
      formatSelectedLandingHeadline({
        rawHeadline: null,
        landingPageUrl: null,
        hasLandingPage: false,
        pending: false,
      }),
    ).toBe("Headline not captured yet");
  });
});

describe("formatSelectedLandingFactValue", () => {
  it("returns the captured label when a landing page exists", () => {
    expect(
      formatSelectedLandingFactValue({
        capturedLabel: "Shop now",
        landingPageUrl: "https://example.com",
        hasLandingPage: true,
        pending: false,
      }),
    ).toBe("Shop now");
  });

  it("returns Analyzing creative… while enrichment is in flight", () => {
    expect(
      formatSelectedLandingFactValue({
        capturedLabel: "Not detected",
        landingPageUrl: "https://example.com",
        hasLandingPage: false,
        pending: true,
      }),
    ).toBe("Analyzing creative…");
  });

  it("returns Unavailable when a URL exists without a snapshot", () => {
    expect(
      formatSelectedLandingFactValue({
        capturedLabel: "Not detected",
        landingPageUrl: "https://example.com",
        hasLandingPage: false,
        pending: false,
      }),
    ).toBe("Unavailable");
  });

  it("returns Couldn't check this page for a failed page check", () => {
    expect(
      formatSelectedLandingFactValue({
        capturedLabel: "Not checked yet",
        landingPageUrl: "https://example.com",
        hasLandingPage: false,
        pending: false,
        failedPageCheck: true,
      }),
    ).toBe("Couldn't check this page");
  });
});

function adForSummary(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Nykaa",
    body: "French Pharmacy collection",
    previewHeadline: "Glow sale",
    previewSubhead: "French Pharmacy collection",
    hook: "",
    offer: "",
    cta: "",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "fixture",
    source: "meta_library_browser",
    analysisFields: [],
    tags: [],
    ...overrides,
  };
}

describe("formatResultCardSummary / formatAdDetailBody broken-unicode guard", () => {
  it("never renders the U+FFFD replacement character from stale cached copy", () => {
    const ad = adForSummary({
      hook: "",
      body: "French Pharmacy collection \uFFFD",
      previewSubhead: "",
      offer: "",
    });

    expect(formatResultCardSummary(ad)).toBe("French Pharmacy collection");
    expect(formatAdDetailBody(ad)).toBe("French Pharmacy collection");
  });

  it("scrubs lone surrogates (which render as U+FFFD in the browser)", () => {
    const ad = adForSummary({
      hook: "",
      body: "French Pharmacy collection \uD83C",
      previewSubhead: "",
      offer: "",
    });

    expect(formatResultCardSummary(ad)).toBe("French Pharmacy collection");
    expect(/[\uD800-\uDFFF]/.test(formatResultCardSummary(ad))).toBe(false);
  });

  it("keeps real emoji (well-formed surrogate pairs) untouched", () => {
    const ad = adForSummary({
      hook: "",
      body: "French Pharmacy collection ✨",
      previewSubhead: "",
      offer: "",
    });

    expect(formatResultCardSummary(ad)).toBe("French Pharmacy collection ✨");
    expect(formatAdDetailBody(ad)).toBe("French Pharmacy collection ✨");
  });

  it("prefers the intact body over a corrupted subhead", () => {
    const ad = adForSummary({
      hook: "",
      body: "French Pharmacy collection ✨",
      previewSubhead: "French Pharmacy collection \uFFFD",
      offer: "",
    });

    expect(formatResultCardSummary(ad)).toContain("✨");
    expect(formatResultCardSummary(ad)).not.toContain("\uFFFD");
  });
});

describe("formatSearchCaptureAgeLabel", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");

  it("renders a deterministic age label independent of the runtime timezone", () => {
    // Same hydration rule as the proof label: the loader computes the label
    // once at request time, so the string must never depend on the zone the
    // server or browser happens to run in.
    for (const timeZone of ["UTC", "Asia/Kolkata", "Pacific/Kiritimati"]) {
      process.env.TZ = timeZone;
      expect(
        formatSearchCaptureAgeLabel("2026-08-12T09:00:00.000Z", now),
      ).toBe("Captured about 3 hours ago");
    }
  });

  it("names minutes, hours and days of snapshot age", () => {
    expect(formatSearchCaptureAgeLabel("2026-08-12T11:59:00.000Z", now)).toBe(
      "Captured about 1 minute ago",
    );
    expect(formatSearchCaptureAgeLabel("2026-08-12T11:00:00.000Z", now)).toBe(
      "Captured about an hour ago",
    );
    expect(formatSearchCaptureAgeLabel("2026-08-12T10:00:00.000Z", now)).toBe(
      "Captured about 2 hours ago",
    );
    expect(formatSearchCaptureAgeLabel("2026-08-11T12:00:00.000Z", now)).toBe(
      "Captured about a day ago",
    );
    expect(formatSearchCaptureAgeLabel("2026-08-09T12:00:00.000Z", now)).toBe(
      "Captured about 3 days ago",
    );
  });

  it("says 'moments ago' for a fresh capture and never shows a future timestamp", () => {
    expect(formatSearchCaptureAgeLabel("2026-08-12T11:59:30.000Z", now)).toBe(
      "Captured moments ago",
    );
    // A clock-skewed cache timestamp must not render as "negative age".
    expect(formatSearchCaptureAgeLabel("2026-08-12T12:30:00.000Z", now)).toBe(
      "Captured moments ago",
    );
  });

  it("returns null when no capture timestamp exists or it is unparseable", () => {
    expect(formatSearchCaptureAgeLabel(undefined, now)).toBeNull();
    expect(formatSearchCaptureAgeLabel(null, now)).toBeNull();
    expect(formatSearchCaptureAgeLabel("not-a-date", now)).toBeNull();
  });
});

describe("formatSearchMarketScope", () => {
  it("returns null when no country is supplied", () => {
    expect(formatSearchMarketScope(null)).toBeNull();
    expect(formatSearchMarketScope(undefined)).toBeNull();
    expect(formatSearchMarketScope("")).toBeNull();
    expect(formatSearchMarketScope("   ")).toBeNull();
  });

  it("keeps the all-countries view unscoped", () => {
    expect(formatSearchMarketScope("all")).toBeNull();
    expect(formatSearchMarketScope("ALL")).toBeNull();
    expect(formatSearchMarketScope("all")).not.toBe("across all countries");
  });

  it("names the market for a specific country", () => {
    expect(formatSearchMarketScope("India")).toBe("in India");
    expect(formatSearchMarketScope("IN")).toBe("in India");
    expect(formatSearchMarketScope("usa")).toBe("in United States");
  });
});

describe("formatSearchCommandTitle", () => {
  it("title-cases the brand and names all countries on a shared search URL", () => {
    expect(formatSearchCommandTitle("nike", "all")).toBe("Nike ads in all countries");
  });

  it("resolves country names from the catalog", () => {
    expect(formatSearchCommandTitle("nike", "IN")).toBe("Nike ads in India");
    expect(formatSearchCommandTitle("nike", "usa")).toBe("Nike ads in United States");
  });

  it("falls back to the generic title when the query is empty", () => {
    expect(formatSearchCommandTitle("", "all")).toBe("Find competitor ads");
    expect(formatSearchCommandTitle("   ", "all")).toBe("Find competitor ads");
  });
});
