/**
 * Issue #2112 — "changed in the last 7 days" proof for the public
 * /ads/:domain pages.
 *
 * When any watchlist tracks the advertiser's domain, its last-7d
 * `watch_event` rows are loaded and projected to the ONLY shape the public
 * page may ship: event type + change mark + capture date. No user data, no
 * watchlist names, no owner identifiers ever leave this module — the event
 * title/summary stay server-side because they can embed the owner's
 * watchlist name.
 *
 * Same zero-cost constraint as the rest of the brand page: bounded D1 reads
 * only — never a live scrape, Browser Rendering run, or Meta API call.
 * Event creation is untouched; this is a read-only projection.
 */

import { readChangeMark, type ChangeMark } from "~/lib/change-mark";
import { registrableDomainFromLandingPage } from "~/lib/competitor-website";
import { queryAll, queryIn } from "~/lib/data/d1.server";
import {
  toWatchEventRecord,
  type WatchEventRow,
} from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import type { WatchEventType } from "~/lib/types";

/** Public proof window: only events captured in the last 7 days render. */
export const ADS_DOMAIN_RECENT_CHANGES_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard bound on rendered rows (newest first). */
export const ADS_DOMAIN_RECENT_CHANGES_LIMIT = 8;

/**
 * The public projection of one watch event: the type, the caught
 * before→after change mark when the stored metadata carries a readable one,
 * and the capture date. Deliberately no id, watchlist id, run id, title, or
 * summary — nothing that identifies the watching account or watchlist.
 */
export interface AdsDomainRecentChange {
  eventType: WatchEventType;
  changeMark: ChangeMark | null;
  capturedAt: string;
}

/**
 * Last-7d watch events for every watchlist tracking `domain`, newest first,
 * capped at ADS_DOMAIN_RECENT_CHANGES_LIMIT. Returns [] when no watchlist
 * tracks the domain (the public section hides in that case).
 *
 * Domain matching follows the established watchlist identity rule (also used
 * by the auto-competitor seed/resweep): an advertiser watchlist's target_id
 * is its normalized website URL, and the registrable domain decides the
 * match — so `https://www.nike.com/launch` and `https://nike.com` are the
 * same watched domain. Query-only advertiser watchlists (no website URL)
 * provably track no domain and never match.
 */
export async function loadAdsDomainRecentChanges(
  env: AppEnv,
  domain: string,
  now: Date = new Date(),
): Promise<AdsDomainRecentChange[]> {
  // id + target_id only — user_id is never read for this public surface.
  const candidates = await queryAll<{ id: string; target_id: string }>(
    env,
    `
      SELECT id, target_id
      FROM watchlist
      WHERE target_type = 'advertiser'
        AND is_active = 1
    `,
  );
  const watchlistIds = candidates
    .filter((row) => registrableDomainFromLandingPage(row.target_id) === domain)
    .map((row) => row.id);
  if (watchlistIds.length === 0) {
    return [];
  }

  const sinceIso = new Date(
    now.getTime() - ADS_DOMAIN_RECENT_CHANGES_WINDOW_MS,
  ).toISOString();
  // Suppressed/invalidated events are excluded at the query, matching the
  // workspace activity feed: they belong to the per-competitor audit trail,
  // never to a proof surface ("no phantom changes").
  const rows = await queryIn<WatchEventRow>(env, {
    buildSql: (placeholders) => `
      SELECT *
      FROM watch_event
      WHERE watchlist_id IN (${placeholders})
        AND status NOT IN ('suppressed', 'invalidated')
        AND created_at >= ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    values: watchlistIds,
    suffix: [sinceIso, ADS_DOMAIN_RECENT_CHANGES_LIMIT],
  });

  // queryIn's LIMIT applies per chunk — re-order and bound the merged window
  // so the cap holds for any number of matching watchlists.
  return rows
    .map(toWatchEventRecord)
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )
    .slice(0, ADS_DOMAIN_RECENT_CHANGES_LIMIT)
    .map((event) => ({
      eventType: event.eventType,
      changeMark: readChangeMark(event),
      capturedAt: event.createdAt,
    }));
}
