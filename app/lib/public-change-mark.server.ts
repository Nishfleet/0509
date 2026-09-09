/**
 * Public change mark — the ONE real before/after shown on the logged-out
 * homepage directly under the first viewport (issue #2170).
 *
 * Source discipline (same bar as public-proof.server.ts):
 * - the mark renders ONLY from a real stored watch event whose metadata
 *   carries both sides of the change (`from`/`to`), read through the shared
 *   change-mark reader (`readChangeMark`) — never a fixture;
 * - the only I/O is one bounded D1 read; a public request never triggers a
 *   scan, a scrape, or any other paid operation;
 * - the competitor label is the watchlist's own target label (a tracked
 *   public advertiser); no account, user, or workspace field is read;
 * - when no stored event qualifies, the loader returns null and the route
 *   renders the honest, explicitly labelled sample state — never a
 *   fabricated "real" change.
 */

import {
  landingPageChangedFieldLabel,
  readChangeMark,
  type ChangeMark,
} from "~/lib/change-mark";
import { queryAll } from "~/lib/data/d1.server";
import {
  toWatchEventRecord,
  type WatchEventRow,
} from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import type { WatchEventRecord } from "~/lib/types";

export interface PublicChangeMark {
  /** The tracked public advertiser (the watchlist's own target label). */
  competitorLabel: string;
  /** What moved, in customer words — "Offer / price", "Headline", ... */
  fieldLabel: string;
  /** The stored before/after token pair. */
  mark: ChangeMark;
  /** Real event clock (confirmedAt, else createdAt). */
  caughtAt: string;
}

interface PublicChangeMarkRow extends WatchEventRow {
  watchlist_target_label: string;
}

/** The changed region in customer words for the event types a mark can carry. */
function publicChangeFieldLabel(eventType: string): string {
  if (eventType.startsWith("website_page_")) return "Website page";
  return landingPageChangedFieldLabel(eventType);
}

/**
 * The newest candidate that carries a readable mark, or null. This is the
 * anti-fabrication gate: an event qualifies only when the shared change-mark
 * reader accepts BOTH stored sides (short, differing tokens) — anything less
 * renders the labelled sample state instead of an invented before/after.
 */
export function pickPublicChangeMark(
  candidates: ReadonlyArray<{ event: WatchEventRecord; competitorLabel: string }>,
): PublicChangeMark | null {
  for (const { event, competitorLabel } of candidates) {
    const mark = readChangeMark(event);
    if (!mark) continue;
    const caughtAt = event.confirmedAt ?? event.createdAt;
    if (!caughtAt) continue;
    const label = competitorLabel.trim();
    if (!label) continue;
    return {
      competitorLabel: label,
      fieldLabel: publicChangeFieldLabel(event.eventType),
      mark,
      caughtAt,
    };
  }
  return null;
}

/**
 * Cache-only read of the newest real stored change mark across tracked
 * public advertisers. Returns null on any D1 hiccup so the route degrades
 * to the labelled sample state, never a 500 and never a fabricated mark.
 */
export async function loadPublicChangeMark(env: AppEnv): Promise<PublicChangeMark | null> {
  try {
    const rows = await queryAll<PublicChangeMarkRow>(
      env,
      `
        SELECT watch_event.*, watchlist.target_label AS watchlist_target_label
        FROM watch_event
        INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
        WHERE watch_event.status = 'confirmed'
          AND json_valid(watch_event.metadata_json)
          AND json_extract(watch_event.metadata_json, '$.from') IS NOT NULL
          AND json_extract(watch_event.metadata_json, '$.to') IS NOT NULL
        ORDER BY watch_event.created_at DESC, watch_event.id DESC
        LIMIT 12
      `,
    );
    return pickPublicChangeMark(
      rows.map((row) => ({
        event: toWatchEventRecord(row),
        competitorLabel: row.watchlist_target_label,
      })),
    );
  } catch (error) {
    console.warn("Homepage change mark load failed; rendering the labelled sample state.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}
