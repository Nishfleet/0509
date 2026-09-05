import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import type { WatchlistDailyActivity } from "~/lib/trend-chart-data";

/**
 * Daily scan-activity rollup for a watchlist, read from healthy succeeded
 * watchlist_run summary_json counters (written by completeWatchlistRun).
 *
 * The window is hard-capped at 90 days because run retention deletes older
 * rows — never promise a longer history than the database keeps.
 */

export const TREND_WINDOW_MAX_DAYS = 90;

interface DailyActivityRow {
	day: string;
	runs: number;
	ads_seen_peak: number | null;
	events_confirmed: number | null;
}

export async function listWatchlistDailyActivity(
	env: AppEnv,
	watchlistId: string,
	options: { days?: number; now?: Date } = {},
): Promise<WatchlistDailyActivity[]> {
	if (!env.DB) {
		return [];
	}

	const days = Math.min(
		TREND_WINDOW_MAX_DAYS,
		Math.max(1, Math.floor(options.days ?? TREND_WINDOW_MAX_DAYS)),
	);
	const now = options.now ?? new Date();
	const sinceIso = new Date(now.getTime() - days * 86_400_000).toISOString();

	// adsSeen is a per-scan snapshot of ads currently live, so the honest daily
	// number is the day's peak (MAX). eventsConfirmed are per-scan increments,
	// so those sum.
	const rows = await queryAll<DailyActivityRow>(
		env,
		`
      SELECT date(started_at) AS day,
             COUNT(*) AS runs,
             MAX(COALESCE(json_extract(summary_json, '$.adsSeen'), 0)) AS ads_seen_peak,
             SUM(COALESCE(json_extract(summary_json, '$.eventsConfirmed'), 0)) AS events_confirmed
      FROM watchlist_run
      WHERE watchlist_id = ?
        AND status = 'succeeded'
        AND COALESCE(json_extract(summary_json, '$.scanStatus'), '') != 'degraded'
        AND started_at >= ?
      GROUP BY date(started_at)
      ORDER BY day ASC
    `,
		watchlistId,
		sinceIso,
	);

	return rows.map((row) => ({
		date: row.day,
		runs: toCount(row.runs),
		adsSeenPeak: toCount(row.ads_seen_peak),
		eventsConfirmed: toCount(row.events_confirmed),
	}));
}

function toCount(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
