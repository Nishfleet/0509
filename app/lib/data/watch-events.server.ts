import {
  execute as run,
  queryAll as many,
  queryIn,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  boolToInt,
  createId,
  createStableId,
  isUniqueConstraintError,
  jsonValue,
  nowIso,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import {
  toEventCandidateRecord,
  toWatchEventRecord,
  type EventCandidateRow,
  type WatchEventRow,
} from "~/lib/data/watchlist-rows.server";
import type { AppEnv } from "~/lib/env.server";
import {
  decodeListCursor,
  nextListCursorFromPage,
  resolveListPageLimit,
  type ListPageOptions,
  type ListPageResult,
} from "~/lib/list-pagination";
import type {
  DedupeReason,
  ProofSkipReason,
  WatchEventStatus,
  WatchEventType,
} from "~/lib/types";
export function legacyWatchEventImportanceScore(eventType: WatchEventType) {
  switch (eventType) {
    case "landing_page_url_changed":
      return 85;
    case "landing_page_headline_changed":
      return 75;
    case "ad_new":
      return 65;
    case "ad_inactive":
      return 60;
    default:
      return 0;
  }
}
export async function listWatchEvents(
  env: AppEnv,
  watchlistId: string,
  limit = 40,
) {
  const rows = await many<WatchEventRow>(
    env,
    `
      SELECT *
      FROM watch_event
      WHERE watchlist_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toWatchEventRecord);
}

export async function listWatchEventsPage(
  env: AppEnv,
  watchlistId: string,
  options: ListPageOptions = {},
): Promise<ListPageResult<ReturnType<typeof toWatchEventRecord>>> {
  const limit = resolveListPageLimit(options.limit, 100);
  const cursor = decodeListCursor(options.cursor);
  const rows = await many<WatchEventRow>(
    env,
    `
      SELECT *
      FROM watch_event
      WHERE watchlist_id = ?
        ${cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    ...(cursor
      ? [watchlistId, cursor.sortValue, cursor.sortValue, cursor.id, limit]
      : [watchlistId, limit]),
  );
  const items = rows.map(toWatchEventRecord);

  return {
    items,
    nextCursor: nextListCursorFromPage(
      items,
      limit,
      (item) => item.createdAt,
      (item) => item.id,
    ),
  };
}

export async function listWatchEventsForRun(
  env: AppEnv,
  watchlistId: string,
  runId: string,
) {
  const rows = await many<WatchEventRow>(
    env,
    `
      SELECT *
      FROM watch_event
      WHERE watchlist_id = ?
        AND run_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    watchlistId,
    runId,
  );

  return rows.map(toWatchEventRecord);
}

/**
 * Loads a single globally ordered activity window for a workspace. The join
 * keeps ownership and active-watch filtering in SQL, avoiding one query per
 * watchlist (and the dashboard's old first-six truncation).
 */
export async function listRecentWorkspaceWatchEvents(
  env: AppEnv,
  userId: string,
  limit = 8,
) {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.floor(limit), 8))
    : 8;
  const rows = await many<WatchEventRow>(
    env,
    `
      SELECT watch_event.*
      FROM watch_event
      INNER JOIN watchlist ON watchlist.id = watch_event.watchlist_id
      WHERE watchlist.user_id = ?
        AND watchlist.is_active = 1
      ORDER BY watch_event.created_at DESC, watch_event.id DESC
      LIMIT ?
    `,
    userId,
    boundedLimit,
  );

  return rows.map(toWatchEventRecord);
}
export async function listWatchEventsByIds(
  env: AppEnv,
  watchlistId: string,
  eventIds: string[],
) {
  const uniqueIds = [...new Set(eventIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const rows = await queryIn<WatchEventRow>(env, {
    buildSql: (placeholders) => `
      SELECT *
      FROM watch_event
      WHERE watchlist_id = ?
        AND id IN (${placeholders})
      ORDER BY created_at ASC
    `,
    values: uniqueIds,
    prefix: [watchlistId],
    chunkSize: 80,
  });

  return rows.map(toWatchEventRecord);
}
export async function listEventCandidates(
  env: AppEnv,
  watchlistId: string,
  limit = 40,
) {
  const rows = await many<EventCandidateRow>(
    env,
    `
      SELECT *
      FROM event_candidate
      WHERE watchlist_id = ?
      ORDER BY detected_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toEventCandidateRecord);
}
export async function listWatchEventsBetween(
  env: AppEnv,
  watchlistId: string,
  periodStart: string,
  periodEnd: string,
) {
  const rows = await many<WatchEventRow>(
    env,
    `
      SELECT *
      FROM watch_event
      WHERE watchlist_id = ?
        AND created_at >= ?
        AND created_at <= ?
      ORDER BY created_at DESC
    `,
    watchlistId,
    periodStart,
    periodEnd,
  );

  return rows.map(toWatchEventRecord);
}
async function getExistingWatchEvent(
  env: AppEnv,
  input: {
    watchlistId: string;
    runId: string;
    eventType: WatchEventType;
    adId: string | null;
    proofCaptureId: string | null | undefined;
    title: string;
    summary: string;
  },
) {
  const row = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watch_event
      WHERE watchlist_id = ?
        AND run_id = ?
        AND event_type = ?
        AND ad_id IS ?
        AND proof_capture_id IS ?
        AND title = ?
        AND summary = ?
      ORDER BY created_at ASC
      LIMIT 1
    `,
    input.watchlistId,
    input.runId,
    input.eventType,
    input.adId,
    input.proofCaptureId,
    input.title,
    input.summary,
  );

  return row?.id ?? null;
}
export async function createWatchEvent(
  env: AppEnv,
  input: {
    watchlistId: string;
    runId: string;
    eventType: WatchEventType;
    adId: string | null;
    baselineFromRunId: string | null;
    title: string;
    summary: string;
    metadata: JsonRecord;
    status?: WatchEventStatus;
    importanceScore?: number;
    candidateId?: string | null;
    proofCaptureId?: string | null;
    confirmedAt?: string | null;
    suppressedAt?: string | null;
    invalidatedAt?: string | null;
    lastEvaluatedAt?: string | null;
  },
) {
  const existingEventId = await getExistingWatchEvent(env, {
    watchlistId: input.watchlistId,
    runId: input.runId,
    eventType: input.eventType,
    adId: input.adId,
    proofCaptureId: input.proofCaptureId,
    title: input.title,
    summary: input.summary,
  });
  if (existingEventId) {
    return existingEventId;
  }

  const id = await createStableId("watch_event", [
    input.watchlistId,
    input.runId,
    input.eventType,
    input.adId,
    input.proofCaptureId ?? null,
    input.title,
    input.summary,
  ]);
  const timestamp = nowIso();
  const status = input.status ?? "confirmed";
  try {
    await run(
      env,
      `
        INSERT INTO watch_event (
          id,
          watchlist_id,
          run_id,
          event_type,
          status,
          importance_score,
          ad_id,
          baseline_from_run_id,
          candidate_id,
          proof_capture_id,
          title,
          summary,
          metadata_json,
          confirmed_at,
          suppressed_at,
          invalidated_at,
          last_evaluated_at,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      id,
      input.watchlistId,
      input.runId,
      input.eventType,
      status,
      input.importanceScore ?? 0,
      input.adId,
      input.baselineFromRunId,
      input.candidateId ?? null,
      input.proofCaptureId ?? null,
      input.title,
      input.summary,
      jsonValue(input.metadata),
      input.confirmedAt ?? (status === "confirmed" ? timestamp : null),
      input.suppressedAt ?? null,
      input.invalidatedAt ?? null,
      input.lastEvaluatedAt ?? timestamp,
      timestamp,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isUniqueConstraintError(message)) {
      throw error;
    }
    const existingId = await getExistingWatchEvent(env, {
      watchlistId: input.watchlistId,
      runId: input.runId,
      eventType: input.eventType,
      adId: input.adId,
      proofCaptureId: input.proofCaptureId,
      title: input.title,
      summary: input.summary,
    });
    if (!existingId) {
      throw error;
    }
    return existingId;
  }

  return id;
}
async function getExistingEventCandidate(
  env: AppEnv,
  input: {
    watchlistId: string;
    runId: string;
    eventType: WatchEventType;
    adId: string | null;
    proofTargetId: string | null | undefined;
    title: string;
    summary: string;
  },
) {
  const row = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM event_candidate
      WHERE watchlist_id = ?
        AND run_id = ?
        AND event_type = ?
        AND ad_id IS ?
        AND proof_target_id IS ?
        AND title = ?
        AND summary = ?
      ORDER BY created_at ASC
      LIMIT 1
    `,
    input.watchlistId,
    input.runId,
    input.eventType,
    input.adId,
    input.proofTargetId,
    input.title,
    input.summary,
  );

  return row?.id ?? null;
}
export async function createEventCandidate(
  env: AppEnv,
  input: {
    watchlistId: string;
    runId: string;
    eventType: WatchEventType;
    status?: WatchEventStatus;
    importanceScore?: number;
    adId: string | null;
    proofTargetId?: string | null;
    title: string;
    summary: string;
    metadata?: JsonRecord;
    proofRequired?: boolean;
    skipReason?: ProofSkipReason | null;
    dedupeReason?: DedupeReason | null;
    detectedAt?: string;
    lastEvaluatedAt?: string | null;
  },
) {
  const existingCandidateId = await getExistingEventCandidate(env, {
    watchlistId: input.watchlistId,
    runId: input.runId,
    eventType: input.eventType,
    adId: input.adId,
    proofTargetId: input.proofTargetId,
    title: input.title,
    summary: input.summary,
  });
  if (existingCandidateId) {
    return existingCandidateId;
  }

  const id = await createStableId("event_candidate", [
    input.watchlistId,
    input.runId,
    input.eventType,
    input.adId,
    input.proofTargetId ?? null,
    input.title,
    input.summary,
  ]);
  const timestamp = nowIso();
  try {
    await run(
      env,
      `
        INSERT INTO event_candidate (
          id,
          watchlist_id,
          run_id,
          event_type,
          status,
          importance_score,
          ad_id,
          proof_target_id,
          title,
          summary,
          metadata_json,
          proof_required,
          skip_reason,
          dedupe_reason,
          detected_at,
          last_evaluated_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      id,
      input.watchlistId,
      input.runId,
      input.eventType,
      input.status ?? "detected",
      input.importanceScore ?? 0,
      input.adId,
      input.proofTargetId ?? null,
      input.title,
      input.summary,
      jsonValue(input.metadata ?? {}),
      boolToInt(input.proofRequired ?? false),
      input.skipReason ?? null,
      input.dedupeReason ?? null,
      input.detectedAt ?? timestamp,
      input.lastEvaluatedAt ?? null,
      timestamp,
      timestamp,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isUniqueConstraintError(message)) {
      throw error;
    }
    const existingId = await getExistingEventCandidate(env, {
      watchlistId: input.watchlistId,
      runId: input.runId,
      eventType: input.eventType,
      adId: input.adId,
      proofTargetId: input.proofTargetId,
      title: input.title,
      summary: input.summary,
    });
    if (!existingId) {
      throw error;
    }
    return existingId;
  }

  return id;
}
