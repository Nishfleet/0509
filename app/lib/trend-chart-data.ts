import { adLongevityDays, formatAdLongevityLabel } from "~/lib/ad-display";
import type { AdRecord } from "~/lib/types";

const MS_PER_DAY = 86_400_000;

export const TREND_SPARSE_MIN_POINTS = 2;

export const LAUNCH_TIMELINE_WEEKS = 12;
export const LONGEVITY_LEADERBOARD_SIZE = 6;
export const SCAN_ACTIVITY_DAYS = 30;

export interface CreativeWallItem {
  ad: AdRecord;
  firstTrackedAt: string;
  lastTrackedAt: string;
  observedRunCount: number;
  isActive: boolean;
}

export interface WatchlistDailyActivity {
  date: string;
  runs: number;
  adsSeenPeak: number;
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

function isoWeekStartTime(time: number): number {
  const date = new Date(time);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return dayStart - daysSinceMonday * MS_PER_DAY;
}

const WEEK_LABEL_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export interface LaunchTimelineBucket {
  weekStart: string;
  label: string;
  count: number;
}

export interface LaunchTimeline {
  buckets: LaunchTimelineBucket[];
  earlierCount: number;
  datedAdCount: number;
  undatedAdCount: number;
  maxCount: number;
  sparse: boolean;
}

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

export interface LongevityLeaderboardEntry {
  adId: string;
  advertiser: string;
  days: number;
  kind: "running" | "tracked";
  label: string;
}

export interface LongevityLeaderboard {
  entries: LongevityLeaderboardEntry[];
  maxDays: number;
  sparse: boolean;
}

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

export interface ScanActivityDay {
  date: string;
  adsSeenPeak: number;
  eventsConfirmed: number;
  hasRuns: boolean;
}

export interface ScanActivitySeries {
  days: ScanActivityDay[];
  scannedDayCount: number;
  totalEventsConfirmed: number;
  maxAdsSeenPeak: number;
  maxEventsConfirmed: number;
  sparse: boolean;
}

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
