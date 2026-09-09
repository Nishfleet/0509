/**
 * Public /ads/:domain last-7-day watch_event proof (issue #2112).
 *
 * Bounded D1 read: when any watchlist tracks this advertiser's domain,
 * return its recent watch_event rows stripped to event type + change mark +
 * capture date. No user data, no watchlist names, no owner identifiers.
 * A miss or a D1 hiccup returns [] so the section hides rather than 500.
 */

import { readChangeMark, type ChangeMark } from "~/lib/change-mark";
import { watchlistDomainForExistingHistory } from "~/lib/first-brief";
import { queryAll } from "~/lib/data/d1.server";
import { parseJson } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import { formatWatchEventTypeLabel } from "~/lib/watch-event-display";
import type { WatchEventType } from "~/lib/types";

export const BRAND_RECENT_WATCH_CHANGE_WINDOW_DAYS = 7;
const BRAND_RECENT_WATCH_CHANGE_FETCH_LIMIT = 40;
const BRAND_RECENT_WATCH_CHANGE_MAX_ROWS = 10;

const CAPTURE_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export interface BrandRecentWatchChange {
  eventType: WatchEventType;
  eventTypeLabel: string;
  changeMark: ChangeMark | null;
  capturedAt: string;
  capturedOn: string;
}

interface RecentWatchEventRow {
  event_type: WatchEventType;
  metadata_json: string;
  created_at: string;
  target_id: string;
  target_label: string;
}

function formatCapturedOn(iso: string): string {
  try {
    return CAPTURE_DATE_FORMATTER.format(new Date(iso));
  } catch {
    return iso;
  }
}

function hasD1(env: AppEnv): boolean {
  return typeof env.DB?.prepare === "function";
}

/**
 * Last-7d watch_event rows for watchlists that track `domain`. Public-safe:
 * the returned objects never carry watchlist ids, names, owners, titles, or
 * raw metadata beyond the short before/after change mark.
 */
export async function loadRecentWatchChangesForDomain(
  env: AppEnv,
  domain: string,
  now: Date = new Date(),
): Promise<BrandRecentWatchChange[]> {
  if (!hasD1(env)) {
    return [];
  }

  const host = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!host) {
    return [];
  }

  const cutoff = new Date(
    now.getTime() - BRAND_RECENT_WATCH_CHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const like = `%${host}%`;

  const rows = await queryAll<RecentWatchEventRow>(
    env,
    `
      SELECT
        watch_event.event_type AS event_type,
        watch_event.metadata_json AS metadata_json,
        watch_event.created_at AS created_at,
        watchlist.target_id AS target_id,
        watchlist.target_label AS target_label
      FROM watch_event
      INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
      WHERE watchlist.is_active = 1
        AND watch_event.status NOT IN ('suppressed', 'invalidated')
        AND watch_event.created_at >= ?
        AND (
          lower(watchlist.target_id) LIKE ?
          OR lower(watchlist.target_label) LIKE ?
        )
      ORDER BY watch_event.created_at DESC
      LIMIT ?
    `,
    cutoff,
    like,
    like,
    BRAND_RECENT_WATCH_CHANGE_FETCH_LIMIT,
  );

  const seen = new Set<string>();
  const changes: BrandRecentWatchChange[] = [];
  for (const row of rows) {
    const trackedHost = watchlistDomainForExistingHistory({
      targetId: row.target_id,
      targetLabel: row.target_label,
    });
    if (trackedHost !== host) {
      continue;
    }

    const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
    const changeMark = readChangeMark({ metadata });
    const dedupeKey = `${row.event_type}|${row.created_at}|${changeMark?.from ?? ""}|${changeMark?.to ?? ""}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    changes.push({
      eventType: row.event_type,
      eventTypeLabel: formatWatchEventTypeLabel(row.event_type),
      changeMark,
      capturedAt: row.created_at,
      capturedOn: formatCapturedOn(row.created_at),
    });
    if (changes.length >= BRAND_RECENT_WATCH_CHANGE_MAX_ROWS) {
      break;
    }
  }

  return changes;
}
