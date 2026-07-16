import { listAdsByIds } from "~/lib/ad-persistence.server";
import { queryAll, queryIn, queryOne } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import type { CreativeWallItem } from "~/lib/trend-chart-data";

/**
 * Creative-wall and trend data for a watchlist: every ad observed by the
 * latest healthy succeeded scan, hydrated from persisted raw_json, each
 * carrying this watchlist's own healthy observation window.
 *
 * Retention truth: watchlist_run rows older than 90 days are swept (newest 5
 * kept), so tracked windows never claim more than the retained history.
 */

interface LatestRunRow {
	id: string;
}

interface LatestObservationRow {
	ad_id: string;
	is_active: number;
}

interface TrackingWindowRow {
	ad_id: string;
	first_tracked_at: string;
	last_tracked_at: string;
	observed_run_count: number;
}

export async function listCreativeWallAds(
	env: AppEnv,
	watchlistId: string,
	limit?: number,
): Promise<CreativeWallItem[]> {
	if (!env.DB) {
		return [];
	}

	const latestRun = await queryOne<LatestRunRow>(
		env,
		`
      SELECT id
      FROM watchlist_run
      WHERE watchlist_id = ?
        AND status = 'succeeded'
        AND COALESCE(json_extract(summary_json, '$.scanStatus'), '') != 'degraded'
      ORDER BY started_at DESC
      LIMIT 1
    `,
		watchlistId,
	);

	if (!latestRun) {
		return [];
	}

	const observations = await queryAll<LatestObservationRow>(
		env,
		`
      SELECT ad_id, is_active
      FROM ad_observation
      WHERE watchlist_run_id = ?
      ORDER BY seen_at DESC
    `,
		latestRun.id,
	);

	const activeByAdId = new Map<string, boolean>();
	for (const observation of observations) {
		if (!activeByAdId.has(observation.ad_id)) {
			activeByAdId.set(observation.ad_id, Boolean(observation.is_active));
		}
	}

	const adIds = [...activeByAdId.keys()];
	if (adIds.length === 0) {
		return [];
	}

	// One GROUP BY across every retained scan of this watchlist gives each ad
	// its observation window; queryIn keeps the IN list under D1's param cap.
	const trackingRows = await queryIn<TrackingWindowRow>(env, {
		buildSql: (placeholders) => `
      SELECT o.ad_id AS ad_id,
             MIN(o.seen_at) AS first_tracked_at,
             MAX(o.seen_at) AS last_tracked_at,
             COUNT(DISTINCT o.watchlist_run_id) AS observed_run_count
      FROM ad_observation o
      JOIN watchlist_run r ON r.id = o.watchlist_run_id
      WHERE r.watchlist_id = ?
        AND r.status = 'succeeded'
        AND COALESCE(json_extract(r.summary_json, '$.scanStatus'), '') != 'degraded'
        AND o.ad_id IN (${placeholders})
      GROUP BY o.ad_id
    `,
		prefix: [watchlistId],
		values: adIds,
	});
	const trackingByAdId = new Map(trackingRows.map((row) => [row.ad_id, row]));

	const ads = await listAdsByIds(env, adIds);

	const items: CreativeWallItem[] = [];
	for (const ad of ads) {
		const tracking = trackingByAdId.get(ad.metaAdId);
		if (!tracking) {
			continue;
		}

		items.push({
			ad,
			firstTrackedAt: tracking.first_tracked_at,
			lastTrackedAt: tracking.last_tracked_at,
			observedRunCount: Number(tracking.observed_run_count) || 0,
			isActive: activeByAdId.get(ad.metaAdId) ?? false,
		});
	}

	// Newest additions first: ads this watchlist started tracking most recently.
	const sortedItems = [...items].sort(
		(left, right) =>
			compareIsoDesc(left.firstTrackedAt, right.firstTrackedAt) ||
			left.ad.metaAdId.localeCompare(right.ad.metaAdId),
	);

	return limit === undefined
		? sortedItems
		: sortedItems.slice(0, Math.max(0, Math.floor(limit)));
}

function compareIsoDesc(left: string, right: string): number {
	const leftTime = Date.parse(left);
	const rightTime = Date.parse(right);
	if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
		return 0;
	}

	return rightTime - leftTime;
}
