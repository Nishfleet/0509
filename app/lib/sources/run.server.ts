import type { AppEnv } from "~/lib/env.server";
import { createStableId, nowIso, type JsonRecord } from "~/lib/data/helpers.server";
import { ensureDb } from "~/lib/data/d1.server";
import { createWatchEvent } from "~/lib/data/watch-events.server";
import type { PlanFamily } from "~/lib/plan-entitlements";
import { getEnabledSources } from "~/lib/sources/registry.server";
import type {
  SourceAdapter,
  SourceChange,
  SourceCompetitorUpdate,
  SourceFetchContext,
  SourceFetchResult,
  SourceSnapshotInput,
  SourceSnapshotRecord,
} from "~/lib/sources/types";

/**
 * The competitor columns a `competitorUpdate` may write. Keys are the
 * `SourceCompetitorUpdate` fields; values are the `watchlist` columns the
 * seam migration created. `persistCompetitorUpdate` only writes columns in
 * this map, so an adapter cannot reach an unrelated column.
 */
const COMPETITOR_UPDATE_COLUMNS: Record<keyof SourceCompetitorUpdate, string> = {
  tiktok_advertiser: "tiktok_advertiser",
  job_board_provider: "job_board_provider",
  job_board_slug: "job_board_slug",
  job_board_verified: "job_board_verified",
};

/**
 * Generic competitor-monitoring source path (seam #2218).
 *
 * One generic path stores snapshots, diffs previous vs current, and emits
 * alerts through the existing Meta alert path (`createWatchEvent`), tagged
 * with `sourceId` in `metadata`. There is no source-specific persistence or
 * alert path. The Meta path is untouched.
 */

interface SourceSnapshotRow {
  id: string;
  watchlist_id: string;
  source_id: string;
  fetched_at: string;
  payload_json: string;
  created_at: string;
}

export async function getLatestSourceSnapshot(
  env: AppEnv,
  watchlistId: string,
  sourceId: string,
): Promise<SourceSnapshotRecord | null> {
  const row = await ensureDb(env)
    .prepare(
      `SELECT id, watchlist_id, source_id, fetched_at, payload_json, created_at
       FROM source_snapshot
       WHERE watchlist_id = ? AND source_id = ?
       ORDER BY fetched_at DESC
       LIMIT 1`,
    )
    .bind(watchlistId, sourceId)
    .first<SourceSnapshotRow>();
  if (!row) return null;
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    sourceId: row.source_id as SourceSnapshotRecord["sourceId"],
    fetchedAt: row.fetched_at,
    payload: JSON.parse(row.payload_json) as JsonRecord,
    createdAt: row.created_at,
  };
}

export async function persistSourceSnapshot(
  env: AppEnv,
  watchlistId: string,
  sourceId: string,
  fetchedAt: string,
  payload: JsonRecord,
): Promise<SourceSnapshotRecord> {
  const id = await createStableId("source_snapshot", [
    watchlistId,
    sourceId,
    fetchedAt,
  ]);
  const createdAt = nowIso();
  await ensureDb(env)
    .prepare(
      `INSERT INTO source_snapshot (id, watchlist_id, source_id, fetched_at, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, watchlistId, sourceId, fetchedAt, JSON.stringify(payload), createdAt)
    .run();
  return { id, watchlistId, sourceId: sourceId as SourceSnapshotRecord["sourceId"], fetchedAt, payload, createdAt };
}

/**
 * Run all enabled source adapters for a competitor, applying each adapter's
 * cadence. Stores snapshots through the generic persistence path, diffs
 * previous vs current, and emits alerts through the existing Meta alert path
 * (`createWatchEvent`), tagged by `sourceId`. Unavailable sources are
 * non-blocking. The Meta path is not touched.
 *
 * `runId` is the current watchlist_run id; alerts are attributed to it.
 */
export async function runSources(
  env: AppEnv,
  competitor: { watchlistId: string; label: string; runId: string },
  plan: PlanFamily,
  now: Date = new Date(),
): Promise<void> {
  const adapters = getEnabledSources(env, plan);
  const context: SourceFetchContext = {
    competitorId: competitor.watchlistId,
    competitorLabel: competitor.label,
  };

  for (const adapter of adapters) {
    if (!shouldRunThisCheck(adapter, now)) continue;
    await runOneSource(env, adapter, context, competitor.runId, now);
  }
}

function shouldRunThisCheck(adapter: SourceAdapter, now: Date): boolean {
  // `each_check` always runs. `daily`/`weekly` are cadence hints for the
  // scheduler; the seam does not add a separate schedule, so the generic path
  // runs every adapter on every check and lets the source ticket decide
  // whether to skip based on its own state. For the seam, all stubs return
  // unavailable, so this is a no-op regardless.
  void adapter;
  void now;
  return true;
}

async function runOneSource(
  env: AppEnv,
  adapter: SourceAdapter,
  context: SourceFetchContext,
  runId: string,
  now: Date,
): Promise<void> {
  let result: SourceFetchResult;
  try {
    result = await adapter.fetch(env, context);
  } catch {
    // Unavailable sources are non-blocking.
    return;
  }

  if ("unavailable" in result && result.unavailable) {
    return;
  }

  const snapshot = result as SourceSnapshotInput;
  const fetchedAt = nowIso();
  const prev = await getLatestSourceSnapshot(env, context.competitorId, adapter.id);
  const stored = await persistSourceSnapshot(
    env,
    context.competitorId,
    adapter.id,
    fetchedAt,
    snapshot.payload,
  );

  // Persist any competitor-column write-back the adapter returned (#2194
  // tiktok_advertiser, #2199 job_board_*). Allowlisted to the seam's own
  // columns; an empty/absent update is a no-op.
  if (snapshot.competitorUpdate) {
    await persistCompetitorUpdate(env, context.competitorId, snapshot.competitorUpdate);
  }

  const changes = adapter.diff(prev, snapshot);
  for (const change of changes) {
    await emitSourceAlert(env, context.competitorId, runId, adapter.id, change);
  }
  void stored;
}

/**
 * Write a `competitorUpdate` to the seam's own columns on `watchlist`. Only
 * keys present in `COMPETITOR_UPDATE_COLUMNS` are written; the rest are
 * ignored. Scoped to the competitor id so one source cannot write another
 * competitor's row. `job_board_verified` is coerced to 0/1.
 */
export async function persistCompetitorUpdate(
  env: AppEnv,
  watchlistId: string,
  update: SourceCompetitorUpdate,
): Promise<void> {
  const entries = (Object.entries(update) as Array<[keyof SourceCompetitorUpdate, unknown]>)
    .filter(([key]) => key in COMPETITOR_UPDATE_COLUMNS)
    .filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return;

  const sets: string[] = [];
  const binds: (string | number)[] = [];
  for (const [key, value] of entries) {
    const column = COMPETITOR_UPDATE_COLUMNS[key];
    sets.push(`${column} = ?`);
    binds.push(key === "job_board_verified" ? (value ? 1 : 0) : String(value));
  }
  binds.push(watchlistId);
  await ensureDb(env)
    .prepare(`UPDATE watchlist SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
}

async function emitSourceAlert(
  env: AppEnv,
  watchlistId: string,
  runId: string,
  sourceId: string,
  change: SourceChange,
): Promise<void> {
  await createWatchEvent(env, {
    watchlistId,
    runId,
    eventType: change.eventType,
    adId: null,
    baselineFromRunId: null,
    title: change.title,
    summary: change.summary,
    metadata: { ...change.metadata, sourceId },
  });
}
