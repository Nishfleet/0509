/**
 * SourceAdapter seam (issue #2333, R1 Architecture lens).
 *
 * Every external observation source lands as a SourceAdapter. A new source
 * ships as ONE new file (a fresh adapter) plus a row appended to the
 * `sourceAdapters` registry -- no new observation table, no changes to
 * `runWatchlist`'s persist loop. The generic `source_observation` table
 * (migration 0090) is the single sink.
 *
 * Deliberately EMPTY seam per the ticket: `sourceAdapters` is `[]`, nothing is
 * persisted yet, and no caller consumes these types. #2181 (Google Ads
 * Transparency) is the first source to fill one in; its accept requires that it
 * land touching only a new adapter file and the registry row.
 */
import type { WatchEventType } from "~/lib/types";
import type { WatchlistRow } from "~/lib/data/watchlist-rows.server";

/** Opaque pagination cursor returned by a source's `fetch`, passed back on the
 * next incremental fetch. `undefined` means "fetch from the beginning". */
export type SourceCursor = string | undefined;

/**
 * One generic observation, the wall-clock shape of the `source_observation`
 * table (migration 0090). `snapshotJson` is the source-specific snapshot
 * payload; reconciling and typing it is the adapter's job, not the table's.
 */
export interface SourceObservation {
  /** Registry key selecting the owning adapter, e.g. "google_ads_transparency". */
  sourceKind: string;
  /** Stable external identifier within the source namespace (e.g. an ad id). */
  externalKey: string;
  /** The watchlist_run this observation was captured in. */
  watchlistRunId: string;
  /** Source-specific structured snapshot, stored verbatim. */
  snapshotJson: string | null;
  /** ISO timestamp the observation was observed/seen. */
  seenAt: string;
  /** Whether the observation is currently live (vs paused/ended). */
  isActive: boolean;
}

/** A pending watch-event produced by `diff`, adapted into the shared
 * watch_event vocabulary. Nothing is created until the caller persists it. */
export interface WatchEventDraft {
  eventType: WatchEventType;
  title: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/**
 * A source implements `fetch` (pull observations, cursor-resumable) and `diff`
 * (turn the current observation set into watch-event drafts against the
 * baseline snapshot).
 */
export interface SourceAdapter {
  fetch(watchlist: WatchlistRow, cursor: SourceCursor): Promise<SourceObservation[]>;
  diff(
    current: SourceObservation[],
    baseline: SourceObservation[] | null,
    prior: SourceObservation[] | null,
  ): WatchEventDraft[];
}

/** Registered source adapters. Empty until the first source (#2181) lands. */
export const sourceAdapters: SourceAdapter[] = [];