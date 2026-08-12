import { afterEach, describe, expect, it } from "vitest";

import { formatProofCaptureLabel } from "~/lib/search-display";
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
