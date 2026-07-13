import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreativeWall } from "~/components/creative-wall";
import { WatchlistTrends } from "~/components/watchlist-trends";
import type { CreativeWallItem, WatchlistDailyActivity } from "~/lib/trend-chart-data";

const baseAd = {
  metaAdId: "ad-1", advertiser: "Nykaa", body: "b", previewHeadline: "h", previewSubhead: "s",
  hook: "h", offer: "o", cta: "Shop now", format: "image" as const, languageLabel: "English",
  destinationType: "website" as const, landingPageUrl: null, adSnapshotUrl: null,
  countries: ["all"], platforms: [], firstSeenAt: "2026-06-01", lastSeenAt: null, active: true,
  researchSummary: "", source: "meta_library_browser" as const, analysisFields: [],
  creativeImageUrl: "https://cdn.example.com/x.png",
};
const items: CreativeWallItem[] = [
  { ad: baseAd, firstTrackedAt: "2026-07-10T04:00:00.000Z", lastTrackedAt: "2026-07-13T04:00:00.000Z", observedRunCount: 3, isActive: true },
  { ad: { ...baseAd, metaAdId: "ad-2", advertiser: "", firstSeenAt: null, creativeImageUrl: null }, firstTrackedAt: "2026-07-01T04:00:00.000Z", lastTrackedAt: "2026-07-13T04:00:00.000Z", observedRunCount: 8, isActive: false },
];
const daily: WatchlistDailyActivity[] = [
  { date: "2026-07-12", runs: 8, adsSeenPeak: 12, eventsConfirmed: 3 },
  { date: "2026-07-13", runs: 4, adsSeenPeak: 10, eventsConfirmed: 0 },
];

describe("creative wall + trend cards rendering", () => {
  it("renders populated wall + trends", () => {
    const wall = renderToStaticMarkup(createElement(CreativeWall, { items, plan: "starter" }));
    expect(wall).toContain("f9-creative-wall");
    expect(wall).toContain("Running");
    expect(wall).toContain("Tracked 12 days");
    expect(wall).toContain("Advertiser unconfirmed");
    expect(wall).toContain("Inactive");

    const trends = renderToStaticMarkup(createElement(WatchlistTrends, { items, dailyActivity: daily, plan: "starter" }));
    expect(trends).toContain("Launch timeline");
    expect(trends).toContain("Longest on air");
    expect(trends).toContain("Scan activity");
    expect(trends).toContain("svg");
    expect(trends).not.toContain("NaN");
    expect(trends).not.toContain("Infinity");
  });

  it("renders free-plan sparse states without chart areas", () => {
    const trends = renderToStaticMarkup(createElement(WatchlistTrends, { items: [], dailyActivity: [], plan: "free" }));
    expect(trends).toContain("free plan takes one snapshot");
    expect(trends).not.toContain("svg");
  });
});
