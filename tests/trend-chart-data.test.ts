import { describe, expect, it } from "vitest";

import {
	buildLaunchTimeline,
	buildLongevityLeaderboard,
	buildScanActivitySeries,
	formatTrackedDaysLabel,
	trackedDaysBetween,
	type CreativeWallItem,
	type WatchlistDailyActivity,
} from "~/lib/trend-chart-data";
import type { AdRecord } from "~/lib/types";

// 2026-07-13 is a Monday, so the 12-week window starts on 2026-04-27.
const NOW = new Date("2026-07-13T12:00:00.000Z");

function buildAd(overrides: Partial<AdRecord> = {}): AdRecord {
	return {
		metaAdId: "ad-1",
		advertiser: "Nykaa",
		body: "Body",
		previewHeadline: "Headline",
		previewSubhead: "Subhead",
		hook: "Hook",
		offer: "Offer",
		cta: "Shop now",
		format: "image",
		languageLabel: "English",
		destinationType: "website",
		landingPageUrl: null,
		adSnapshotUrl: null,
		countries: ["all"],
		platforms: [],
		firstSeenAt: null,
		lastSeenAt: null,
		active: true,
		researchSummary: "",
		source: "meta_library_browser",
		analysisFields: [],
		...overrides,
	};
}

function buildItem(
	overrides: Partial<CreativeWallItem> = {},
	adOverrides: Partial<AdRecord> = {},
): CreativeWallItem {
	return {
		ad: buildAd(adOverrides),
		firstTrackedAt: "2026-07-13T04:00:00.000Z",
		lastTrackedAt: "2026-07-13T04:00:00.000Z",
		observedRunCount: 1,
		isActive: true,
		...overrides,
	};
}

describe("buildLaunchTimeline", () => {
	it("buckets dated ads by ISO week (Monday start) with zero weeks kept", () => {
		const items = [
			// Sunday 2026-07-12 belongs to the week starting Monday 2026-07-06.
			buildItem({}, { metaAdId: "a", firstSeenAt: "2026-07-12" }),
			buildItem({}, { metaAdId: "b", firstSeenAt: "2026-07-06" }),
			buildItem({}, { metaAdId: "c", firstSeenAt: "2026-05-04" }),
		];

		const timeline = buildLaunchTimeline(items, NOW);

		expect(timeline.buckets).toHaveLength(12);
		expect(timeline.buckets[0].weekStart).toBe("2026-04-27");
		expect(timeline.buckets[11].weekStart).toBe("2026-07-13");
		const byWeek = new Map(timeline.buckets.map((bucket) => [bucket.weekStart, bucket.count]));
		expect(byWeek.get("2026-07-06")).toBe(2);
		expect(byWeek.get("2026-05-04")).toBe(1);
		expect(byWeek.get("2026-07-13")).toBe(0);
		expect(timeline.datedAdCount).toBe(3);
		expect(timeline.maxCount).toBe(2);
		expect(timeline.sparse).toBe(false);
	});

	it("counts ads that started before the window retroactively as earlier, not dropped", () => {
		const items = [
			buildItem({}, { metaAdId: "old-1", firstSeenAt: "2025-11-01" }),
			buildItem({}, { metaAdId: "old-2", firstSeenAt: "2026-01-15" }),
			buildItem({}, { metaAdId: "new-1", firstSeenAt: "2026-07-10" }),
		];

		const timeline = buildLaunchTimeline(items, NOW);

		expect(timeline.earlierCount).toBe(2);
		expect(timeline.datedAdCount).toBe(3);
		expect(timeline.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1);
		expect(timeline.sparse).toBe(false);
	});

	it("separates undated ads and never invents a start date for them", () => {
		const items = [
			buildItem({}, { metaAdId: "dated", firstSeenAt: "2026-07-10" }),
			buildItem({}, { metaAdId: "undated", firstSeenAt: null }),
			buildItem({}, { metaAdId: "garbage", firstSeenAt: "not-a-date" }),
		];

		const timeline = buildLaunchTimeline(items, NOW);

		expect(timeline.datedAdCount).toBe(1);
		expect(timeline.undatedAdCount).toBe(2);
		expect(timeline.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1);
	});

	it("clamps future-published dates into the current week instead of inventing one", () => {
		const items = [
			buildItem({}, { metaAdId: "future", firstSeenAt: "2026-07-20" }),
			buildItem({}, { metaAdId: "now", firstSeenAt: "2026-07-13" }),
		];

		const timeline = buildLaunchTimeline(items, NOW);

		const currentWeek = timeline.buckets[11];
		expect(currentWeek.weekStart).toBe("2026-07-13");
		expect(currentWeek.count).toBe(2);
	});

	it("is sparse below two dated ads", () => {
		expect(buildLaunchTimeline([], NOW).sparse).toBe(true);
		expect(
			buildLaunchTimeline([buildItem({}, { firstSeenAt: "2026-07-10" })], NOW).sparse,
		).toBe(true);
		expect(
			buildLaunchTimeline(
				[
					buildItem({}, { metaAdId: "a", firstSeenAt: "2026-07-10" }),
					buildItem({}, { metaAdId: "b", firstSeenAt: "2026-07-11" }),
				],
				NOW,
			).sparse,
		).toBe(false);
	});
});

describe("trackedDaysBetween", () => {
	it("floors to full days with a one-day minimum", () => {
		expect(trackedDaysBetween("2026-07-10T04:00:00.000Z", "2026-07-13T05:00:00.000Z")).toBe(3);
		expect(trackedDaysBetween("2026-07-13T04:00:00.000Z", "2026-07-13T07:00:00.000Z")).toBe(1);
	});

	it("returns null for unusable windows", () => {
		expect(trackedDaysBetween("2026-07-13T04:00:00.000Z", "2026-07-10T04:00:00.000Z")).toBeNull();
		expect(trackedDaysBetween("garbage", "2026-07-13T04:00:00.000Z")).toBeNull();
	});
});

describe("buildLongevityLeaderboard", () => {
	it("ranks by days desc, capped at six", () => {
		const items = Array.from({ length: 8 }, (_, index) =>
			buildItem(
				{},
				{
					metaAdId: `ad-${index}`,
					advertiser: `Brand ${index}`,
					// ad-0 started 1 day ago, ad-7 started 8 days ago.
					firstSeenAt: new Date(NOW.getTime() - (index + 1) * 86_400_000).toISOString(),
				},
			),
		);

		const leaderboard = buildLongevityLeaderboard(items, NOW);

		expect(leaderboard.entries).toHaveLength(6);
		expect(leaderboard.entries[0].adId).toBe("ad-7");
		expect(leaderboard.entries[0].days).toBe(8);
		expect(leaderboard.entries.map((entry) => entry.days)).toEqual([8, 7, 6, 5, 4, 3]);
		expect(leaderboard.maxDays).toBe(8);
		expect(leaderboard.sparse).toBe(false);
	});

	it("labels Meta-published longevity as Running and observation-only as Tracked, never conflated", () => {
		const items = [
			buildItem(
				{},
				{
					metaAdId: "published",
					firstSeenAt: new Date(NOW.getTime() - 40 * 86_400_000).toISOString(),
				},
			),
			buildItem(
				{
					firstTrackedAt: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(),
					lastTrackedAt: NOW.toISOString(),
				},
				{ metaAdId: "observed", firstSeenAt: null },
			),
		];

		const leaderboard = buildLongevityLeaderboard(items, NOW);

		const published = leaderboard.entries.find((entry) => entry.adId === "published");
		const observed = leaderboard.entries.find((entry) => entry.adId === "observed");
		expect(published).toMatchObject({ kind: "running", days: 40, label: "Running 40 days" });
		expect(observed).toMatchObject({ kind: "tracked", days: 5, label: "Tracked 5 days" });
	});

	it("never lets an inactive creative with no published end keep accruing running days", () => {
		const inactive = buildItem(
			{
				firstTrackedAt: "2026-05-01T00:00:00.000Z",
				lastTrackedAt: "2026-05-10T00:00:00.000Z",
				isActive: false,
			},
			{
				metaAdId: "inactive",
				firstSeenAt: "2026-01-01T00:00:00.000Z",
				lastSeenAt: null,
				active: false,
			},
		);

		const july = buildLongevityLeaderboard([inactive], NOW);
		const august = buildLongevityLeaderboard(
			[inactive],
			new Date("2026-08-13T12:00:00.000Z"),
		);

		expect(july.entries[0]).toMatchObject({
			kind: "tracked",
			days: 9,
			label: "Tracked 9 days",
		});
		expect(august.entries[0]).toEqual(july.entries[0]);
		expect(august.maxDays).toBe(9);
	});

	it("skips ads with no usable window at all and flags sparse below two entries", () => {
		const items = [
			buildItem(
				{ firstTrackedAt: "garbage", lastTrackedAt: "garbage" },
				{ metaAdId: "broken", firstSeenAt: null },
			),
			buildItem({}, { metaAdId: "ok", firstSeenAt: "2026-07-10" }),
		];

		const leaderboard = buildLongevityLeaderboard(items, NOW);

		expect(leaderboard.entries).toHaveLength(1);
		expect(leaderboard.entries[0].adId).toBe("ok");
		expect(leaderboard.sparse).toBe(true);
	});
});

describe("formatTrackedDaysLabel", () => {
	it("pluralizes honestly", () => {
		expect(formatTrackedDaysLabel(1)).toBe("Tracked 1 day");
		expect(formatTrackedDaysLabel(12)).toBe("Tracked 12 days");
	});
});

describe("buildScanActivitySeries", () => {
	const daily: WatchlistDailyActivity[] = [
		{ date: "2026-07-13", runs: 8, adsSeenPeak: 12, eventsConfirmed: 3 },
		{ date: "2026-07-11", runs: 4, adsSeenPeak: 9, eventsConfirmed: 1 },
		{ date: "2026-06-01", runs: 2, adsSeenPeak: 5, eventsConfirmed: 2 },
	];

	it("fills the last 30 days oldest-first, leaving gap days at zero", () => {
		const series = buildScanActivitySeries(daily, NOW);

		expect(series.days).toHaveLength(30);
		expect(series.days[0].date).toBe("2026-06-14");
		expect(series.days[29].date).toBe("2026-07-13");
		expect(series.days[29]).toMatchObject({ adsSeenPeak: 12, eventsConfirmed: 3, hasRuns: true });
		// 2026-07-12 had no succeeded scans — the gap stays visible.
		expect(series.days[28]).toMatchObject({ adsSeenPeak: 0, eventsConfirmed: 0, hasRuns: false });
		// 2026-06-01 falls outside the 30-day window.
		expect(series.scannedDayCount).toBe(2);
		expect(series.totalEventsConfirmed).toBe(4);
		expect(series.maxAdsSeenPeak).toBe(12);
		expect(series.maxEventsConfirmed).toBe(3);
		expect(series.sparse).toBe(false);
	});

	it("is sparse below two scanned days", () => {
		expect(buildScanActivitySeries([], NOW).sparse).toBe(true);
		expect(
			buildScanActivitySeries(
				[{ date: "2026-07-13", runs: 1, adsSeenPeak: 3, eventsConfirmed: 0 }],
				NOW,
			).sparse,
		).toBe(true);
	});
});
