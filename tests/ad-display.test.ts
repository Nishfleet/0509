import { describe, expect, it } from "vitest";

import {
  adLongevityDays,
  formatAdCaptureSinceLabel,
  formatAdLongevityLabel,
  STRONG_LONGEVITY_DAYS,
} from "~/lib/ad-display";

const NOW = new Date("2026-06-12T12:00:00.000Z");

describe("formatAdLongevityLabel", () => {
  it("returns null when firstSeenAt is missing (no badge when we don't know)", () => {
    expect(formatAdLongevityLabel({ firstSeenAt: null, lastSeenAt: null }, NOW)).toBeNull();
    expect(
      formatAdLongevityLabel({ firstSeenAt: null, lastSeenAt: "2026-06-10T00:00:00.000Z" }, NOW),
    ).toBeNull();
  });

  it("floors a same-day ad to Running 1 day", () => {
    expect(
      formatAdLongevityLabel(
        { firstSeenAt: "2026-06-12T08:00:00.000Z", lastSeenAt: "2026-06-12T11:00:00.000Z" },
        NOW,
      ),
    ).toBe("Running 1 day");
  });

  it("counts whole days between firstSeenAt and lastSeenAt", () => {
    expect(
      formatAdLongevityLabel(
        { firstSeenAt: "2026-04-01T00:00:00.000Z", lastSeenAt: "2026-05-16T00:00:00.000Z" },
        NOW,
      ),
    ).toBe("Running 45 days");
  });

  it("falls back to now when lastSeenAt is missing", () => {
    expect(
      formatAdLongevityLabel({ firstSeenAt: "2026-06-05T12:00:00.000Z", lastSeenAt: null }, NOW),
    ).toBe("Running 7 days");
  });

  it("returns null for a future firstSeenAt (clock-skew guard)", () => {
    expect(
      formatAdLongevityLabel({ firstSeenAt: "2026-06-13T00:00:00.000Z", lastSeenAt: null }, NOW),
    ).toBeNull();
  });

  it("returns null for unusable timestamps", () => {
    expect(
      formatAdLongevityLabel({ firstSeenAt: "not-a-date", lastSeenAt: null }, NOW),
    ).toBeNull();
    expect(
      formatAdLongevityLabel(
        { firstSeenAt: "2026-06-10T00:00:00.000Z", lastSeenAt: "2026-06-01T00:00:00.000Z" },
        NOW,
      ),
    ).toBeNull();
  });
});

describe("formatAdCaptureSinceLabel", () => {
  it("renders the per-ad capture date in pinned en-GB UTC copy", () => {
    expect(
      formatAdCaptureSinceLabel(
        { firstSeenAt: "2026-06-01T00:00:00.000Z" },
        NOW,
      ),
    ).toBe("Since 1 Jun 2026");
    expect(
      formatAdCaptureSinceLabel(
        { firstSeenAt: "2025-10-24T12:30:00.000Z" },
        NOW,
      ),
    ).toBe("Since 24 Oct 2025");
  });

  it("returns null when firstSeenAt is missing (no date when we don't know)", () => {
    expect(formatAdCaptureSinceLabel({ firstSeenAt: null }, NOW)).toBeNull();
  });

  it("returns null for unusable timestamps", () => {
    expect(formatAdCaptureSinceLabel({ firstSeenAt: "not-a-date" }, NOW)).toBeNull();
  });

  it("returns null for a future firstSeenAt (clock-skew guard)", () => {
    expect(
      formatAdCaptureSinceLabel({ firstSeenAt: "2026-06-13T00:00:00.000Z" }, NOW),
    ).toBeNull();
  });
});

describe("adLongevityDays", () => {
  it("mirrors the label's null cases", () => {
    expect(adLongevityDays({ firstSeenAt: null, lastSeenAt: null }, NOW)).toBeNull();
    expect(adLongevityDays({ firstSeenAt: "2099-01-01T00:00:00.000Z", lastSeenAt: null }, NOW)).toBeNull();
  });

  it("flags long-running ads at the strong threshold", () => {
    const days = adLongevityDays(
      { firstSeenAt: "2026-03-14T12:00:00.000Z", lastSeenAt: null },
      NOW,
    );
    expect(days).toBe(90);
    expect(days !== null && days >= STRONG_LONGEVITY_DAYS).toBe(true);
  });
});
