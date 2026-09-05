import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const CREATIVE_TRENDS_TEST_NOW = new Date("2026-07-15T00:00:00.000Z");

describe("creative wall + trend cards rendering", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(CREATIVE_TRENDS_TEST_NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

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

	it("uses the closed tracked window for an inactive ad with a published start date", () => {
		const inactiveItem: CreativeWallItem = {
			ad: {
				...baseAd,
				metaAdId: "ad-inactive-dated",
				active: false,
				firstSeenAt: "2025-01-01",
			},
			firstTrackedAt: "2026-07-01T04:00:00.000Z",
			lastTrackedAt: "2026-07-13T04:00:00.000Z",
			observedRunCount: 8,
			isActive: false,
		};

		const wall = renderToStaticMarkup(
			createElement(CreativeWall, { items: [inactiveItem], plan: "starter" }),
		);

		expect(wall).toContain("Tracked 12 days");
		expect(wall).toContain("Inactive");
		expect(wall).not.toContain("Running ");
	});

	it("renders free-plan sparse states without chart areas", () => {
		const trends = renderToStaticMarkup(createElement(WatchlistTrends, { items: [], dailyActivity: [], plan: "free" }));
		expect(trends).toContain("free plan takes one snapshot");
		expect(trends).not.toContain("svg");
	});

	it("caps and labels only the wall preview while trends use the full creative set", () => {
		const fullItems: CreativeWallItem[] = Array.from({ length: 20 }, (_, index) => ({
			...items[0],
			ad: {
				...baseAd,
				metaAdId: `ad-${index + 1}`,
				advertiser: index === 19 ? "Outside preview leader" : baseAd.advertiser,
				firstSeenAt:
					index === 19 ? "2020-01-01" : `2026-06-${String(index + 1).padStart(2, "0")}`,
			},
		}));

		const wall = renderToStaticMarkup(
			createElement(CreativeWall, { items: fullItems, plan: "starter" }),
		);
		const trends = renderToStaticMarkup(
			createElement(WatchlistTrends, {
				items: fullItems,
				dailyActivity: daily,
				plan: "starter",
			}),
		);

		expect(wall).toContain("Showing 18 of 20 creatives");
		expect(wall.match(/class="f9-creative-tile(?: is-inactive)?"/g)).toHaveLength(18);
		expect(wall).not.toContain("Outside preview leader");
		expect(trends).toContain('20<span class="f9-trend-unit"> dated ads</span>');
		expect(trends).toContain("+1 started earlier");
		expect(trends).toContain("Outside preview leader");
	});
});
