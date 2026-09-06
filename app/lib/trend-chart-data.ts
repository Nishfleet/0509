import { adLongevityDays, formatAdLongevityLabel } from "~/lib/ad-display";
import type { AdRecord } from "~/lib/types";

/**
 * Pure chart math for the watchlist creative wall + trend cards. No D1, no
 * network — every function here maps already-fetched rows into render-ready
 * datasets so the numbers stay unit-testable.
 *
 * Honesty rules baked in:
 * - "Running N days" only ever comes from an active ad with Meta's published
 *   start date (firstSeenAt); inactive ads use our closed tracking window.
 *   "Tracked N days" only comes from our own observation window.
 *   The two are never conflated.
 * - Charts flag themselves sparse below TREND_SPARSE_MIN_POINTS instead of
 *   pretending a lone point is a trend.
 */

const MS_PER_DAY = 86_400_000;

/** Below this many real data points a chart renders its sparse state. */
export const TREND_SPARSE_MIN_POINTS = 2;

export const LAUNCH_TIMELINE_WEEKS = 12;
export const LONGEVITY_LEADERBOARD_SIZE = 6;
export const SCAN_ACTIVITY_DAYS = 30;

/** One creative on the wall: the ad plus this watchlist's observation window. */
export interface CreativeWallItem {
	ad: AdRecord;
	/** Earliest time this watchlist observed the ad (our data, not Meta's). */
	firstTrackedAt: string;
	/** Latest time this watchlist observed the ad. */
	lastTrackedAt: string;
	/** Distinct scans that saw the ad. */
	observedRunCount: number;
	/** Active flag from the most recent scan's observation. */
	isActive: boolean;
}

/** One day of succeeded scans, aggregated from watchlist_run.summary_json. */
export interface WatchlistDailyActivity {
	/** UTC calendar day, YYYY-MM-DD. */
	date: string;
	runs: number;
	/** Highest adsSeen across the day's scans (peak ads live, not a sum). */
	adsSeenPeak: number;
	/** Total eventsConfirmed across the day's scans. */
	eventsConfirmed: number;
}

function parseTime(value: string | null | undefined): number | null {
	if (!value) {
		return null;
	}

	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : parsed;
}

function utcDayIso(time: number): string {
	return new Date(time).toISOString().slice(0, 10);
}

/** UTC Monday (start of the ISO week) for the given time. */
function isoWeekStartTime(time: number): number {
	const date = new Date(time);
	const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	// getUTCDay: Sunday 0 … Saturday 6; ISO weeks start Monday.
	const daysSinceMonday = (date.getUTCDay() + 6) % 7;
	return dayStart - daysSinceMonday * MS_PER_DAY;
}

const WEEK_LABEL_FORMAT = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});

// --- Launch timeline -------------------------------------------------------

export interface LaunchTimelineBucket {
	/** ISO week start (UTC Monday), YYYY-MM-DD. */
	weekStart: string;
	/** Compact label for the week start, e.g. "13 Jul". */
	label: string;
	count: number;
}

export interface LaunchTimeline {
	/** Oldest → newest, one bucket per ISO week in the window (zeros kept). */
	buckets: LaunchTimelineBucket[];
	/** Ads whose published start date falls before the charted window. */
	earlierCount: number;
	/** Ads with a Meta-published start date (the chartable population). */
	datedAdCount: number;
	/** Ads Meta did not publish a readable start date for. */
	undatedAdCount: number;
	maxCount: number;
	sparse: boolean;
}

/**
 * Buckets wall ads by the ISO week of Meta's published start date
 * (firstSeenAt). Ads that started before the charted window are counted in
 * `earlierCount` rather than silently dropped — retroactive history is the
 * point of this chart.
 */
export function buildLaunchTimeline(
	items: readonly CreativeWallItem[],
	now: Date = new Date(),
	weeks: number = LAUNCH_TIMELINE_WEEKS,
): LaunchTimeline {
	const currentWeekStart = isoWeekStartTime(now.getTime());
	const windowStart = currentWeekStart - (weeks - 1) * 7 * MS_PER_DAY;
	const countsByWeekStart = new Map<number, number>();
	let earlierCount = 0;
	let datedAdCount = 0;
	let undatedAdCount = 0;

	for (const item of items) {
		const startedTime = parseTime(item.ad.firstSeenAt);
		if (startedTime === null) {
			undatedAdCount += 1;
			continue;
		}

		datedAdCount += 1;
		// Clock-skew guard: a published date "in the future" charts in the
		// current week rather than inventing a week that has not happened.
		const weekStart = isoWeekStartTime(Math.min(startedTime, now.getTime()));
		if (weekStart < windowStart) {
			earlierCount += 1;
			continue;
		}

		countsByWeekStart.set(weekStart, (countsByWeekStart.get(weekStart) ?? 0) + 1);
	}

	const buckets: LaunchTimelineBucket[] = [];
	for (let index = 0; index < weeks; index += 1) {
		const weekStart = windowStart + index * 7 * MS_PER_DAY;
		buckets.push({
			weekStart: utcDayIso(weekStart),
			label: WEEK_LABEL_FORMAT.format(new Date(weekStart)),
			count: countsByWeekStart.get(weekStart) ?? 0,
		});
	}

	return {
		buckets,
		earlierCount,
		datedAdCount,
		undatedAdCount,
		maxCount: buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0),
		sparse: datedAdCount < TREND_SPARSE_MIN_POINTS,
	};
}

// --- Longevity leaderboard -------------------------------------------------

export interface LongevityLeaderboardEntry {
	adId: string;
	advertiser: string;
	days: number;
	/** "running" = Meta's published start date; "tracked" = our own window. */
	kind: "running" | "tracked";
	/** "Running N days" or "Tracked N days" — provenance stays visible. */
	label: string;
}

export interface LongevityLeaderboard {
	entries: LongevityLeaderboardEntry[];
	maxDays: number;
	sparse: boolean;
}

/** Full days between first and last tracked observation, one-day floor. */
export function trackedDaysBetween(
	firstTrackedAt: string,
	lastTrackedAt: string,
): number | null {
	const first = parseTime(firstTrackedAt);
	const last = parseTime(lastTrackedAt);
	if (first === null || last === null || last < first) {
		return null;
	}

	return Math.max(1, Math.floor((last - first) / MS_PER_DAY));
}

export function formatTrackedDaysLabel(days: number): string {
  return days === 1 ? "Tracked 1 day" : `Tracked ${days} days`;
}

/**
 * Top ads by days on air. Active ads use Meta's published start date when
 * present ("Running N days"). Inactive or undated ads use the closed local
 * observation window ("Tracked N days"), so they never keep accruing after
 * their last observation and the two sources are never conflated.
 */
export function buildLongevityLeaderboard(
	items: readonly CreativeWallItem[],
	now: Date = new Date(),
	limit: number = LONGEVITY_LEADERBOARD_SIZE,
): LongevityLeaderboard {
	const entries: LongevityLeaderboardEntry[] = [];

	for (const item of items) {
		if (!item.isActive) {
			const trackedDays = trackedDaysBetween(item.firstTrackedAt, item.lastTrackedAt);
			if (trackedDays !== null) {
				entries.push({
					adId: item.ad.metaAdId,
					advertiser: item.ad.advertiser,
					days: trackedDays,
					kind: "tracked",
					label: formatTrackedDaysLabel(trackedDays),
				});
			}
			continue;
		}

		const runningDays = adLongevityDays(item.ad, now);
		const runningLabel = formatAdLongevityLabel(item.ad, now);

		if (runningDays !== null && runningLabel !== null) {
			entries.push({
				adId: item.ad.metaAdId,
				advertiser: item.ad.advertiser,
				days: runningDays,
				kind: "running",
				label: runningLabel,
			});
			continue;
		}

		const trackedDays = trackedDaysBetween(item.firstTrackedAt, item.lastTrackedAt);
		if (trackedDays !== null) {
			entries.push({
				adId: item.ad.metaAdId,
				advertiser: item.ad.advertiser,
				days: trackedDays,
				kind: "tracked",
				label: formatTrackedDaysLabel(trackedDays),
			});
		}
	}

	const ranked = [...entries]
		.sort((left, right) => right.days - left.days || left.adId.localeCompare(right.adId))
		.slice(0, limit);

	return {
		entries: ranked,
		maxDays: ranked.reduce((max, entry) => Math.max(max, entry.days), 0),
		sparse: ranked.length < TREND_SPARSE_MIN_POINTS,
	};
}

// --- Scan activity ---------------------------------------------------------

export interface ScanActivityDay {
	/** UTC calendar day, YYYY-MM-DD. */
	date: string;
	adsSeenPeak: number;
	eventsConfirmed: number;
	hasRuns: boolean;
}

export interface ScanActivitySeries {
	/** Oldest → newest, one entry per day in the window (zero-filled). */
	days: ScanActivityDay[];
	/** Days that actually had at least one succeeded scan. */
	scannedDayCount: number;
	totalEventsConfirmed: number;
	maxAdsSeenPeak: number;
	maxEventsConfirmed: number;
	sparse: boolean;
}

/**
 * Fills the last `days` UTC calendar days with per-day scan counts. Days
 * without a succeeded scan stay visibly zero — a gap is information, not
 * something to interpolate over.
 */
export function buildScanActivitySeries(
	daily: readonly WatchlistDailyActivity[],
	now: Date = new Date(),
	days: number = SCAN_ACTIVITY_DAYS,
): ScanActivitySeries {
	const byDate = new Map(daily.map((entry) => [entry.date, entry]));
	const nowTime = now.getTime();
	const series: ScanActivityDay[] = [];
	let scannedDayCount = 0;
	let totalEventsConfirmed = 0;

	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const date = utcDayIso(nowTime - offset * MS_PER_DAY);
		const entry = byDate.get(date);
		const hasRuns = Boolean(entry && entry.runs > 0);
		if (hasRuns) {
			scannedDayCount += 1;
		}
		totalEventsConfirmed += entry?.eventsConfirmed ?? 0;
		series.push({
			date,
			adsSeenPeak: entry?.adsSeenPeak ?? 0,
			eventsConfirmed: entry?.eventsConfirmed ?? 0,
			hasRuns,
		});
	}

	return {
		days: series,
		scannedDayCount,
		totalEventsConfirmed,
		maxAdsSeenPeak: series.reduce((max, day) => Math.max(max, day.adsSeenPeak), 0),
		maxEventsConfirmed: series.reduce((max, day) => Math.max(max, day.eventsConfirmed), 0),
		sparse: scannedDayCount < TREND_SPARSE_MIN_POINTS,
	};
}
