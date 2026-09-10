import type { ComponentType } from "react";
import type { JsonRecord } from "~/lib/data/helpers.server";
import type { WatchEventType } from "~/lib/types";

/**
 * The six competitor-monitoring source adapters the seam (#2218) registers.
 * Each source ticket (#2181, #2189, #2193, #2194, #2198, #2199) replaces one
 * stub adapter with a real implementation and flips `implemented` to true.
 */
export const SOURCE_IDS = [
  "google",
  "google_ads",
  "linkedin",
  "tiktok",
  "subdomains",
  "hiring",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const SOURCE_KINDS = ["ads", "search", "signal"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_CADENCES = ["each_check", "daily", "weekly"] as const;
export type SourceCadence = (typeof SOURCE_CADENCES)[number];

/**
 * Competitor-column write-back a fetch may return alongside its snapshot.
 * `runSources` persists these to the seam's own columns on `watchlist`
 * (created by the seam migration): `tiktok_advertiser` (#2194) and the
 * `job_board_*` triple (#2199). Without this channel those source tickets
 * cannot persist the fields the migration creates. Only the columns named
 * here are writable; `runSources` allowlists the keys before any UPDATE.
 */
export interface SourceCompetitorUpdate {
  tiktok_advertiser?: string;
  job_board_provider?: string;
  job_board_slug?: string;
  job_board_verified?: number;
}

/**
 * A successful fetch result. The adapter owns the payload shape; the seam
 * stores it verbatim as JSON in `source_snapshot.payload_json`. An optional
 * `competitorUpdate` writes back to the seam's competitor columns.
 */
export interface SourceSnapshotInput {
  unavailable?: false;
  payload: JsonRecord;
  competitorUpdate?: SourceCompetitorUpdate;
}

/**
 * A fetch that could not produce a snapshot. Stubs return this with
 * `reason: "not_implemented"`. Unavailable never blocks the Meta path.
 */
export interface SourceUnavailable {
  unavailable: true;
  reason: string;
}

export type SourceFetchResult = SourceSnapshotInput | SourceUnavailable;

/**
 * One diff entry an adapter produces by comparing the previous and next
 * snapshot. The seam emits each change through the existing Meta alert path
 * (`createWatchEvent`) tagged with `sourceId` in `metadata`.
 */
export interface SourceChange {
  eventType: WatchEventType;
  title: string;
  summary: string;
  metadata: JsonRecord;
}

/**
 * A stored source snapshot row (`source_snapshot` table).
 */
export interface SourceSnapshotRecord {
  id: string;
  watchlistId: string;
  sourceId: SourceId;
  fetchedAt: string;
  payload: JsonRecord;
  createdAt: string;
}

export interface SourceFetchContext {
  /** The competitor watchlist id the snapshot is for. */
  competitorId: string;
  /** The competitor label, for display copy. */
  competitorLabel: string;
}

/**
 * A competitor-monitoring source adapter. The seam registers six of these;
 * the source tickets replace the stubs. `Section` is the React component the
 * competitor page renders for this source — stubs render nothing.
 */
export interface SourceAdapter {
  id: SourceId;
  label: string;
  kind: SourceKind;
  /** Stubs export false; the coverage map shows "coming soon" until true. */
  implemented: boolean;
  cadence: SourceCadence;
  /** True when the env has the credentials/config the source needs. */
  requiresEnv: (env: unknown) => boolean;
  fetch: (env: unknown, competitor: SourceFetchContext) => Promise<SourceFetchResult>;
  diff: (prev: SourceSnapshotRecord | null, next: SourceSnapshotInput) => SourceChange[];
  Section: ComponentType<{ snapshot: SourceSnapshotRecord | null; diff: SourceChange[] }>;
}
