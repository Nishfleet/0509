import { afterEach, describe, expect, it } from "vitest";

import {
  formatAdDetailBody,
  formatProofCaptureLabel,
  formatResultCardSummary,
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
