import { queryAll, queryOne } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Narrow read queries behind the competitor dossier ("Intelligence" section).
 * Everything reads EXISTING tables (watchlist_run, ad_observation, ad,
 * watch_event) — no new schema. Every query is user-scoped through the owning
 * watchlist row so a dossier can never read across workspaces.
 *
 * "Healthy" mirrors listCreativeWallAds: succeeded runs whose summary is not
 * degraded. Retention truth: watchlist_run rows older than 90 days are swept
 * (newest 5 kept), so every number here is bounded by retained history — the
 * dossier states its evidence window instead of implying all-time coverage.
 */

/** Healthy-run predicate for a watchlist_run aliased as `alias`. */
function healthyRunFilter(alias: string) {
  return `
    ${alias}.status = 'succeeded'
    AND COALESCE(json_extract(${alias}.summary_json, '$.scanStatus'), '') != 'degraded'
  `;
}

export const LANDING_PAGE_CHANGE_EVENT_TYPES = [
  "landing_page_url_changed",
  "landing_page_headline_changed",
  "landing_page_offer_changed",
  "landing_page_cta_changed",
  "landing_page_form_changed",
] as const;

const LANDING_PAGE_EVENT_PLACEHOLDERS = LANDING_PAGE_CHANGE_EVENT_TYPES.map(() => "?").join(", ");

export interface DossierObservationRow {
  ad_id: string;
  hook: string;
  offer_text: string | null;
  cta: string | null;
  creative_format: string;
  meta_first_seen_at: string | null;
  first_observed_at: string;
  last_observed_at: string;
  observed_run_count: number;
  latest_is_active: number;
  /** Meta-published variant count from persisted raw_json; null when unknown. */
  variant_count: number | null;
}

/**
 * One row per distinct ad this watchlist has EVER observed in retained healthy
 * scans, with its local observation window and the active flag from its most
 * recent observation. Ordered oldest-first so the caller can read the
 * evidence window straight off the first row.
 */
export async function listDossierObservationHistory(
  env: AppEnv,
  watchlistId: string,
  userId: string,
): Promise<DossierObservationRow[]> {
  return queryAll<DossierObservationRow>(
    env,
    `
      SELECT
        o.ad_id AS ad_id,
        ad.hook AS hook,
        ad.offer_text AS offer_text,
        ad.cta AS cta,
        ad.creative_format AS creative_format,
        ad.first_seen_at AS meta_first_seen_at,
        json_extract(ad.raw_json, '$.variantCount') AS variant_count,
        MIN(o.seen_at) AS first_observed_at,
        MAX(o.seen_at) AS last_observed_at,
        COUNT(DISTINCT o.watchlist_run_id) AS observed_run_count,
        (
          SELECT o2.is_active
          FROM ad_observation o2
          JOIN watchlist_run r2 ON r2.id = o2.watchlist_run_id
          WHERE o2.ad_id = o.ad_id
            AND r2.watchlist_id = w.id
            AND ${healthyRunFilter("r2")}
          ORDER BY o2.seen_at DESC, o2.id DESC
          LIMIT 1
        ) AS latest_is_active
      FROM ad_observation o
      JOIN watchlist_run r ON r.id = o.watchlist_run_id
      JOIN watchlist w ON w.id = r.watchlist_id
      JOIN ad ON ad.id = o.ad_id
      WHERE w.id = ?
        AND w.user_id = ?
        AND ${healthyRunFilter("r")}
      GROUP BY o.ad_id
      ORDER BY first_observed_at ASC, o.ad_id ASC
    `,
    watchlistId,
    userId,
  );
}

export interface DossierScanStatsRow {
  scan_count: number;
  first_scan_at: string | null;
}

/** Count + earliest start of retained healthy scans for this watchlist. */
export async function getDossierHealthyScanStats(
  env: AppEnv,
  watchlistId: string,
  userId: string,
): Promise<DossierScanStatsRow | null> {
  return queryOne<DossierScanStatsRow>(
    env,
    `
      SELECT COUNT(*) AS scan_count, MIN(r.started_at) AS first_scan_at
      FROM watchlist_run r
      JOIN watchlist w ON w.id = r.watchlist_id
      WHERE w.id = ?
        AND w.user_id = ?
        AND ${healthyRunFilter("r")}
    `,
    watchlistId,
    userId,
  );
}

/** Confirmed landing-page change events only — matches what alert emails send. */
export async function countDossierLandingPageChanges(
  env: AppEnv,
  watchlistId: string,
  userId: string,
): Promise<number> {
  const row = await queryOne<{ total: number }>(
    env,
    `
      SELECT COUNT(*) AS total
      FROM watch_event e
      JOIN watchlist w ON w.id = e.watchlist_id
      WHERE w.id = ?
        AND w.user_id = ?
        AND e.status = 'confirmed'
        AND e.event_type IN (${LANDING_PAGE_EVENT_PLACEHOLDERS})
    `,
    watchlistId,
    userId,
    ...LANDING_PAGE_CHANGE_EVENT_TYPES,
  );
  return Number(row?.total ?? 0);
}

export interface DossierLandingPageChangeRow {
  id: string;
  event_type: string;
  title: string;
  created_at: string;
}

/** Newest confirmed landing-page change event, if any. */
export async function getDossierLatestLandingPageChange(
  env: AppEnv,
  watchlistId: string,
  userId: string,
): Promise<DossierLandingPageChangeRow | null> {
  return queryOne<DossierLandingPageChangeRow>(
    env,
    `
      SELECT e.id AS id, e.event_type AS event_type, e.title AS title, e.created_at AS created_at
      FROM watch_event e
      JOIN watchlist w ON w.id = e.watchlist_id
      WHERE w.id = ?
        AND w.user_id = ?
        AND e.status = 'confirmed'
        AND e.event_type IN (${LANDING_PAGE_EVENT_PLACEHOLDERS})
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1
    `,
    watchlistId,
    userId,
    ...LANDING_PAGE_CHANGE_EVENT_TYPES,
  );
}
