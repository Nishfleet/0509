import {
  ensureDb,
  execute as run,
  queryAll as many,
  queryIn,
  queryOne as one,
} from "~/lib/data/d1.server";
import { bindD1Named } from "~/lib/d1-bind.server";
import { billingCanaryMutationGuardSql } from "~/lib/data/billing-canary-lock.server";
import { createId, createStableId, jsonValue, nowIso, type JsonRecord } from "~/lib/data/helpers.server";
import {
  toWatchlistRunRecord,
  type ObservationRow,
  type WatchlistRunRow,
} from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import {
  decodeListCursor,
  nextListCursorFromPage,
  resolveListPageLimit,
  type ListPageOptions,
  type ListPageResult,
} from "~/lib/list-pagination";
import type { WatchlistRunRecord } from "~/lib/types";
const OBSERVATION_RUN_PAGE_SIZE = 200;

export async function listWatchlistRunPairsForEventIds(
  env: AppEnv,
  userId: string,
  eventIds: string[],
) {
  const uniqueEventIds = [...new Set(eventIds.filter(Boolean))];
  if (uniqueEventIds.length === 0) return [];

  const rows = await queryIn<{
    id: string;
    started_at: string;
    finished_at: string | null;
  }>(env, {
    buildSql: (placeholders) => `
      SELECT DISTINCT
        watchlist_run.id,
        watchlist_run.started_at,
        watchlist_run.finished_at
      FROM watch_event
      INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
      INNER JOIN watchlist_run
        ON watchlist_run.id = watch_event.run_id
        OR watchlist_run.id = watch_event.baseline_from_run_id
      WHERE watch_event.id IN (${placeholders})
        AND watchlist.user_id = ?
    `,
    values: uniqueEventIds,
    suffix: [userId],
  });
  return rows.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}

export async function hasInFlightWatchlistRun(
  env: AppEnv,
  watchlistId: string,
  sinceIso: string,
) {
  const row = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watchlist_run
      WHERE watchlist_id = ?
        AND status IN ('pending', 'running')
        AND started_at >= ?
      LIMIT 1
    `,
    watchlistId,
    sinceIso,
  );
  return Boolean(row);
}
export async function countWatchlistRunsForUserSince(
  env: AppEnv,
  userId: string,
  sinceIso: string,
) {
  const row = await one<{ total: number }>(
    env,
    `
      SELECT COUNT(*) AS total
      FROM watchlist_run
      INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
      WHERE watchlist.user_id = ?
        AND watchlist_run.started_at >= ?
    `,
    userId,
    sinceIso,
  );
  return row?.total ?? 0;
}
export interface FirstScanRunState {
  watchlistId: string;
  status: WatchlistRunRecord["status"];
  errorCode: string | null;
}

/**
 * Latest first-scan run per active watchlist of a workspace that has no
 * successful scan history yet. Powers the same-session first-value surface:
 * the Overview can say "running now" / "starts shortly" / "couldn't finish"
 * instead of a static queued claim, and it stops polling the moment nothing
 * is still waiting. Only run rows with the first-scan execution key are
 * considered, so a later scheduled run never mislabels a first scan.
 */
export async function listFirstScanRunStates(
  env: AppEnv,
  userId: string,
): Promise<FirstScanRunState[]> {
  const rows = await many<{
    watchlist_id: string;
    status: string;
    error_code: string | null;
  }>(
    env,
    `
      SELECT watchlist.id AS watchlist_id,
             run.status AS status,
             run.error_code AS error_code
      FROM watchlist
      LEFT JOIN watchlist_run AS run
        ON run.id = (
          SELECT latest.id
          FROM watchlist_run AS latest
          WHERE latest.watchlist_id = watchlist.id
            AND latest.idempotency_key LIKE 'watchlist-run:first-scan:%'
          ORDER BY latest.created_at DESC
          LIMIT 1
        )
      WHERE watchlist.user_id = ?
        AND watchlist.is_active = 1
        AND watchlist.last_scanned_at IS NULL
    `,
    userId,
  );
  return rows.map((row) => ({
    watchlistId: row.watchlist_id,
    status: row.status as WatchlistRunRecord["status"],
    errorCode: row.error_code,
  }));
}

export async function createWatchlistRun(
  env: AppEnv,
  watchlistId: string,
  triggerType: WatchlistRunRecord["triggerType"],
  baselineFromRunId: string | null,
  pageBudget: number,
  initialSummary: JsonRecord = {},
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO watchlist_run (
        id,
        watchlist_id,
        trigger_type,
        status,
        page_budget,
        pages_scanned,
        baseline_from_run_id,
        summary_json,
        started_at,
        finished_at,
        error_code,
        error_message,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'running', ?, 0, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `,
    id,
    watchlistId,
    triggerType,
    pageBudget,
    baselineFromRunId,
    jsonValue(initialSummary),
    timestamp,
    timestamp,
    timestamp,
  );

  return id;
}
export async function finishWatchlistRun(
  env: AppEnv,
  runId: string,
  input: {
    status: WatchlistRunRecord["status"];
    pagesScanned: number;
    summary: JsonRecord;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE watchlist_run
      SET status = ?,
          pages_scanned = ?,
          summary_json = ?,
          finished_at = ?,
          error_code = ?,
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `,
    input.status,
    input.pagesScanned,
    jsonValue(input.summary),
    timestamp,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    timestamp,
    runId,
  );
}
export async function getRecentSuccessfulRuns(
  env: AppEnv,
  watchlistId: string,
  limit = 3,
) {
  const rows = await many<WatchlistRunRow>(
    env,
    `
      SELECT *
      FROM watchlist_run
      WHERE watchlist_id = ? AND status = 'succeeded'
      ORDER BY started_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );
  return rows.map(toWatchlistRunRecord);
}
export function buildCapacitySkipIdempotencyKey(input: {
  watchlistId: string;
  scheduledTime?: number;
  cron?: string | null;
  triggerType?: WatchlistRunRecord["triggerType"];
}) {
  const triggerType = input.triggerType ?? "scheduled";
  const slot = new Date(input.scheduledTime ?? Date.now()).toISOString().replace(/[:.]/g, "-");
  const cronFragment = (input.cron ?? "daily").replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `capacity_budget:${triggerType}:${input.watchlistId}:${cronFragment}:${slot}`;
}
export async function recordWatchlistCapacitySkip(
  env: AppEnv,
  watchlistId: string,
  input: {
    triggerType?: WatchlistRunRecord["triggerType"];
    reason?: string;
    scheduledTime?: number;
    cron?: string | null;
    idempotencyKey?: string;
  } = {},
) {
  const id = createId();
  const timestamp = nowIso();
  const triggerType = input.triggerType ?? "scheduled";
  const idempotencyKey =
    input.idempotencyKey ??
    buildCapacitySkipIdempotencyKey({
      watchlistId,
      scheduledTime: input.scheduledTime,
      cron: input.cron,
      triggerType,
    });
  const summary = {
    reason: input.reason ?? "capacity_budget",
    message:
      "The scheduled scan window filled before this watchlist was reached. It stays queued for the next run.",
  };

  const db = ensureDb(env);
  const insert = await bindD1Named(
    db.prepare(`
        INSERT OR IGNORE INTO watchlist_run (
          id,
          watchlist_id,
          trigger_type,
          status,
          page_budget,
          pages_scanned,
          baseline_from_run_id,
          summary_json,
          started_at,
          finished_at,
          error_code,
          error_message,
          idempotency_key,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'skipped', 0, 0, NULL, ?, ?, ?, 'capacity_budget', ?, ?, ?, ?)
      `),
    [
      ["capacitySkip.id", id],
      ["capacitySkip.watchlistId", watchlistId],
      ["capacitySkip.triggerType", triggerType],
      ["capacitySkip.summary", jsonValue(summary)],
      ["capacitySkip.startedAt", timestamp],
      ["capacitySkip.finishedAt", timestamp],
      ["capacitySkip.errorMessage", summary.message],
      ["capacitySkip.idempotencyKey", idempotencyKey],
      ["capacitySkip.createdAt", timestamp],
      ["capacitySkip.updatedAt", timestamp],
    ],
  ).run();

  if (Number(insert.meta?.changes ?? 0) > 0) {
    return id;
  }

  const existing = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watchlist_run
      WHERE idempotency_key = ?
      LIMIT 1
    `,
    idempotencyKey,
  );
  return existing?.id ?? id;
}
export async function listWatchlistRuns(
  env: AppEnv,
  watchlistId: string,
  limit = 12,
) {
  const rows = await many<WatchlistRunRow>(
    env,
    `
      SELECT *
      FROM watchlist_run
      WHERE watchlist_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toWatchlistRunRecord);
}

/**
 * Latest run for a watchlist by `started_at`, regardless of status. Used by
 * the run-history capture-attempts read path (issue #1289) so the
 * `/api/v1/watchlists/:id/runs/latest` response and the evidence UI show the
 * most recent check — including failed, skipped, and in-flight runs, not
 * only successful ones. Returns `null` when the watchlist has never run.
 */
export async function getLatestWatchlistRun(
  env: AppEnv,
  watchlistId: string,
) {
  const row = await one<WatchlistRunRow>(
    env,
    `
      SELECT *
      FROM watchlist_run
      WHERE watchlist_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `,
    watchlistId,
  );
  return row ? toWatchlistRunRecord(row) : null;
}
export async function touchWatchlistScanned(env: AppEnv, watchlistId: string) {
  const timestamp = nowIso();
  const billingCanaryGuard = await billingCanaryMutationGuardSql(env, "watchlist.user_id");
  await run(
    env,
    `
      UPDATE watchlist
      SET last_scanned_at = ?, updated_at = ?
      WHERE id = ?
        ${billingCanaryGuard}
    `,
    timestamp,
    timestamp,
    watchlistId,
  );
}
export function isSoftScanFailure(status: string, errorCode: string | null | undefined) {
  return status === "failed" && (errorCode === "rate_limited" || errorCode === "cache_only");
}
export function countLeadingFailures(statuses: string[]) {
  let count = 0;
  for (const status of statuses) {
    if (status !== "failed") break;
    count += 1;
  }
  return count;
}
export async function getSuccessfulRunStatsForUserBetween(
  env: AppEnv,
  userId: string,
  startIso: string,
  endIso: string,
) {
  const row = await one<{
    runs: number;
    watchlists_checked: number;
    ads_seen: number | null;
    no_change_runs: number | null;
  }>(
    env,
    `
      SELECT
        COUNT(*) AS runs,
        COUNT(DISTINCT watchlist_run.watchlist_id) AS watchlists_checked,
        SUM(COALESCE(json_extract(watchlist_run.summary_json, '$.adsSeen'), 0)) AS ads_seen,
        SUM(
          CASE
            WHEN json_type(watchlist_run.summary_json, '$.adsSeen') IN ('integer', 'real')
              AND json_extract(watchlist_run.summary_json, '$.adsSeen') = 0
            THEN 1
            ELSE 0
          END
        ) AS no_change_runs
      FROM watchlist_run
      INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
      WHERE watchlist.user_id = ?
        AND watchlist_run.status = 'succeeded'
        AND COALESCE(json_extract(watchlist_run.summary_json, '$.scanStatus'), '') != 'degraded'
        AND watchlist_run.finished_at >= ?
        AND watchlist_run.finished_at < ?
    `,
    userId,
    startIso,
    endIso,
  );

  return {
    runs: Number(row?.runs ?? 0),
    watchlistsChecked: Number(row?.watchlists_checked ?? 0),
    adsSeen: Number(row?.ads_seen ?? 0),
    noChangeRuns: Number(row?.no_change_runs ?? 0),
  };
}
export async function createAdObservation(
  env: AppEnv,
  input: {
    adId: string;
    watchlistRunId: string;
    landingPageSnapshotId: string | null;
    landingPageUrl: string | null;
    seenAt: string;
    isActive: boolean;
    metadata?: JsonRecord;
  },
) {
  const id = await createStableId("ad_observation", [input.watchlistRunId, input.adId]);
  await bindD1Named(
    ensureDb(env).prepare(`
      INSERT INTO ad_observation (
        id,
        ad_id,
        watchlist_run_id,
        landing_page_snapshot_id,
        seen_at,
        is_active,
        landing_page_url,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        landing_page_snapshot_id = COALESCE(excluded.landing_page_snapshot_id, ad_observation.landing_page_snapshot_id),
        seen_at = CASE
          WHEN excluded.seen_at > ad_observation.seen_at THEN excluded.seen_at
          ELSE ad_observation.seen_at
        END,
        is_active = excluded.is_active,
        landing_page_url = COALESCE(excluded.landing_page_url, ad_observation.landing_page_url),
        metadata_json = excluded.metadata_json
    `),
    [
      ["adObservation.id", id],
      ["adObservation.adId", input.adId],
      ["adObservation.watchlistRunId", input.watchlistRunId],
      [
        "adObservation.landingPageSnapshotId",
        input.landingPageSnapshotId,
        "null",
      ],
      ["adObservation.seenAt", input.seenAt],
      [
        "adObservation.isActive",
        input.isActive === undefined
          ? undefined
          : input.isActive
            ? 1
            : 0,
      ],
      ["adObservation.landingPageUrl", input.landingPageUrl, "null"],
      ["adObservation.metadata", jsonValue(input.metadata ?? {})],
      ["adObservation.createdAt", nowIso()],
    ],
  ).run();

  return id;
}
export async function listObservationsForRunPage(
  env: AppEnv,
  runId: string,
  options: ListPageOptions = {},
): Promise<ListPageResult<ObservationRow>> {
  const limit = resolveListPageLimit(options.limit, OBSERVATION_RUN_PAGE_SIZE);
  const cursor = decodeListCursor(options.cursor);
  const rows = await many<ObservationRow>(
    env,
    `
      SELECT
        ad_observation.id,
        ad_observation.ad_id,
        ad_observation.watchlist_run_id,
        ad_observation.landing_page_snapshot_id,
        ad_observation.landing_page_url,
        ad_observation.seen_at,
        ad_observation.is_active,
        ad_observation.metadata_json,
        landing_page_snapshot.normalized_headline_hash,
        landing_page_snapshot.raw_headline
      FROM ad_observation
      LEFT JOIN landing_page_snapshot
        ON landing_page_snapshot.id = ad_observation.landing_page_snapshot_id
      WHERE ad_observation.watchlist_run_id = ?
        ${cursor ? "AND (ad_observation.seen_at > ? OR (ad_observation.seen_at = ? AND ad_observation.id > ?))" : ""}
      ORDER BY ad_observation.seen_at ASC, ad_observation.id ASC
      LIMIT ?
    `,
    ...(cursor
      ? [runId, cursor.sortValue, cursor.sortValue, cursor.id, limit]
      : [runId, limit]),
  );

  return {
    items: rows,
    nextCursor: nextListCursorFromPage(
      rows,
      limit,
      (item) => item.seen_at,
      (item) => item.id,
    ),
  };
}
export async function listObservationsForRun(
  env: AppEnv,
  runId: string,
  options: ListPageOptions = {},
) {
  // Scan/diff semantics require the full observation set for a run. Page
  // internally unless the caller asks for an explicit single page.
  if (options.limit != null || options.cursor != null) {
    const page = await listObservationsForRunPage(env, runId, options);
    return page.items;
  }

  const items: ObservationRow[] = [];
  let cursor: string | null = null;
  do {
    const page = await listObservationsForRunPage(env, runId, {
      limit: OBSERVATION_RUN_PAGE_SIZE,
      cursor,
    });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}
