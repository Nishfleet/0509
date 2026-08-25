import { describe, expect, it } from "vitest";

import { buildPublicProofBrief } from "~/lib/public-proof.server";
import type { AdRecord } from "~/lib/types";

const FETCHED_AT = "2026-08-20T14:27:13.848Z";
const NOW = new Date("2026-08-20T17:27:13.848Z");

function makeDateOnlyAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "meta-1",
    advertiser: "Nykaa",
    body: "Body copy",
    previewHeadline: "Preview headline",
    previewSubhead: "Preview subhead",
    hook: "Unlock the secret to radiant skin",
    offer: "₹400 Off",
    cta: "Learn more",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nykaa.com/lp",
    adSnapshotUrl: "https://www.facebook.com/ads/library/?id=1",
    countries: ["India"],
    platforms: ["Instagram"],
    // Date-only — the shape parseStartedRunningDate produces for browser-scraped
    // Meta Ad Library cards and the shape ad_delivery_start_time returns.
    firstSeenAt: "2026-03-01",
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

function buildDateOnlyBrief() {
  return buildPublicProofBrief([makeDateOnlyAd(), makeDateOnlyAd({ metaAdId: "meta-2" })], {
    fetchedAt: FETCHED_AT,
    country: "all",
    freshForLiveClaim: false,
    checkedAgoLabel: "about 3 hours ago",
    website: "nykaa.com",
    now: NOW,
  });
}

describe("public proof brief — date-only captures", () => {
  it("never fabricates a 12:00 AM timestamp in the decision strings", () => {
    const brief = buildDateOnlyBrief();
    expect(brief).not.toBeNull();
    if (!brief) return;

    expect(brief.decision.proofStatus).not.toContain("12:00 AM");
    expect(brief.decision.freshness).not.toContain("12:00 AM");
  });

  it("never fabricates a 12:00 AM timestamp in the insight timeline", () => {
    const brief = buildDateOnlyBrief();
    expect(brief).not.toBeNull();
    if (!brief) return;

    for (const entry of brief.insights.timeline) {
      expect(entry).not.toContain("12:00 AM");
    }
  });

  it("renders the calendar date for a date-only firstSeenAt", () => {
    const brief = buildDateOnlyBrief();
    expect(brief).not.toBeNull();
    if (!brief) return;

    // "Mar 1" is the en-locale short-month + numeric-day rendering of
    // 2026-03-01 at UTC (pinned by timeZone: "UTC").
    // formatCapturedAt(firstSeenAt) is applied in the insight timeline
    // ("Creative started running …"), not decision.proofStatus — that
    // string is formatCapturedAt(fetchedAt), the cache clock.
    expect(
      brief.insights.timeline.some((entry) => entry.includes("Mar 1")),
    ).toBe(true);
  });

  it("passes the raw date-only string through as the trail capturedAt", () => {
    const brief = buildDateOnlyBrief();
    expect(brief).not.toBeNull();
    if (!brief) return;

    // trailCapturedAt returns lastSeenAt || firstSeenAt || fetchedAt.
    // With lastSeenAt null and firstSeenAt date-only, the trail carries the
    // raw YYYY-MM-DD — which proofTimeLabel in the routes must handle.
    const trailDate = brief.proofTrail[0]?.capturedAt;
    expect(trailDate).toBe("2026-03-01");
  });

  it("still renders a full timestamp with time for a full-ISO firstSeenAt", () => {
    const ad = makeDateOnlyAd({ firstSeenAt: "2026-03-01T09:47:00.000Z" });
    const brief = buildPublicProofBrief([ad], {
      fetchedAt: FETCHED_AT,
      country: "all",
      freshForLiveClaim: false,
      checkedAgoLabel: "about 3 hours ago",
      website: "nykaa.com",
      now: NOW,
    });
    expect(brief).not.toBeNull();
    if (!brief) return;

    // Full-ISO captures keep the clock — the date-only guard must not suppress
    // the time for real timestamps that actually have one. firstSeenAt lands
    // in the insight timeline via formatCapturedAt, not in proofStatus.
    const started = brief.insights.timeline.find((entry) =>
      entry.startsWith("Creative started running"),
    );
    expect(started).toBeDefined();
    expect(started).toContain("Mar 1");
    expect(started).toMatch(/\d{1,2}:\d{2}/);
  });
});
