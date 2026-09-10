/**
 * Public timeline source-event loader (issue #2200).
 *
 * /timeline/:domain already renders the offer-ledger (landing-page snapshots).
 * Issue #2200 adds events from the new competitor-monitoring source diffs
 * (a new Google creative, a new LinkedIn ad, a new public subdomain, roles
 * opened, etc.) using the SAME watch_event stream the offer timeline and the
 * /ads "changed in the last 7 days" strip already read from.
 *
 * Source alerts are written by the seam's `emitSourceAlert` tagged with
 * `sourceId` in `metadata`. This loader finds watchlists tracking the domain
 * (same identity rule as `loadAdsDomainRecentChanges`), loads their recent
 * watch_event rows, and projects ONLY the events whose `metadata.sourceId`
 * belongs to a LIVE source (adapter implemented + env-enabled — the same
 * claim gate the /ads source sections use). Non-source events and events
 * for stub sources never surface.
 *
 * Read-only: bounded D1 reads, never a fetch. A read hiccup degrades to []
 * (the section hides) rather than 500ing the page.
 */
import { registrableDomainFromLandingPage } from "~/lib/competitor-website";
import { queryAll, queryIn } from "~/lib/data/d1.server";
import {
  toWatchEventRecord,
  type WatchEventRow,
} from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import { readChangeMark } from "~/lib/change-mark";
import { SOURCES } from "~/lib/sources/registry.server";
import type { ChangeMark } from "~/lib/change-mark";
import type { SourceId } from "~/lib/sources/types";
import type { WatchEventType } from "~/lib/types";

/** Public proof window — matches the /ads recent-changes strip. */
export const TIMELINE_SOURCE_EVENTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard bound on rendered source events (newest first). */
export const TIMELINE_SOURCE_EVENTS_LIMIT = 12;

/**
 * The public projection of one source watch event: the event type, the
 * caught before→after change mark when stored, the capture date, and the
 * source label (from the live adapter). No id, watchlist id, run id, title,
 * or summary — nothing that identifies the watching account. The label is
 * the adapter's public `label`, never the watchlist name.
 */
export interface TimelineSourceEvent {
  eventType: WatchEventType;
  changeMark: ChangeMark | null;
  capturedAt: string;
  sourceId: SourceId;
  sourceLabel: string;
}

/**
 * Recent source-diff watch events for every watchlist tracking `domain`,
 * newest first, capped at TIMELINE_SOURCE_EVENTS_LIMIT. Only events tagged
 * with a LIVE source's `sourceId` surface. Returns [] when no watchlist
 * tracks the domain, no live source exists, or no source event landed.
 */
export async function loadTimelineSourceEvents(
  env: AppEnv,
  domain: string,
  now: Date = new Date(),
): Promise<TimelineSourceEvent[]> {
  // Live sources for this env — the claim gate. Only events whose
  // metadata.sourceId matches one of these surface.
  const liveSources = SOURCES.filter(
    (adapter) => adapter.implemented && adapter.requiresEnv(env),
  );
  if (liveSources.length === 0) {
    return [];
  }
  const liveSourceIds = new Set(liveSources.map((s) => s.id));
  const labelById = new Map(liveSources.map((s) => [s.id, s.label]));

  // Find every advertiser watchlist tracking this domain — same identity
  // rule as loadAdsDomainRecentChanges.
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
    now.getTime() - TIMELINE_SOURCE_EVENTS_WINDOW_MS,
  ).toISOString();
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
    suffix: [sinceIso, TIMELINE_SOURCE_EVENTS_LIMIT],
  });

  return rows
    .map(toWatchEventRecord)
    .filter((event) => {
      const sourceId = event.metadata?.sourceId;
      return typeof sourceId === "string" && liveSourceIds.has(sourceId as SourceId);
    })
    .map((event) => {
      const sourceId = event.metadata?.sourceId as SourceId;
      return {
        eventType: event.eventType,
        changeMark: readChangeMark(event),
        capturedAt: event.createdAt,
        sourceId,
        sourceLabel: labelById.get(sourceId) ?? sourceId,
      };
    })
    .sort(
      (a, b) =>
        b.capturedAt.localeCompare(a.capturedAt) || b.sourceId.localeCompare(a.sourceId),
    )
    .slice(0, TIMELINE_SOURCE_EVENTS_LIMIT);
}
