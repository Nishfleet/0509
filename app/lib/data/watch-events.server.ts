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
async function getExistingProofBackedWatchEvent(
  env: AppEnv,
  input: {
    watchlistId: string;
    runId: string;
    eventType: WatchEventType;
    proofCaptureId: string | null | undefined;
    title: string;
    summary: string;
  },
) {
  if (!input.proofCaptureId) return null;
  const row = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watch_event
      WHERE watchlist_id = ?
        AND run_id = ?
        AND event_type = ?
        AND proof_capture_id = ?
        AND title = ?
        AND summary = ?
      ORDER BY created_at ASC
      LIMIT 1
    `,
    input.watchlistId,
    input.runId,
    input.eventType,
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
  const existingProofBackedEventId = await getExistingProofBackedWatchEvent(env, {
    watchlistId: input.watchlistId,
    runId: input.runId,
    eventType: input.eventType,
    proofCaptureId: input.proofCaptureId,
    title: input.title,
    summary: input.summary,
  });
  if (existingProofBackedEventId) {
    return existingProofBackedEventId;
  }

  const id = input.proofCaptureId
    ? await createStableId("watch_event", [
        input.watchlistId,
        input.runId,
        input.eventType,
        input.proofCaptureId,
        input.title,
        input.summary,
      ])
    : createId();
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
    if (!input.proofCaptureId || !isUniqueConstraintError(message)) {
      throw error;
    }
    const existingId = await getExistingProofBackedWatchEvent(env, {
      watchlistId: input.watchlistId,
      runId: input.runId,
      eventType: input.eventType,
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
async function getExistingProofBackedEventCandidate(
  env: AppEnv,
  input: {
    watchlistId: string;
    runId: string;
    eventType: WatchEventType;
    proofTargetId: string | null | undefined;
    title: string;
    summary: string;
  },
) {
  if (!input.proofTargetId) return null;
  const row = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM event_candidate
      WHERE watchlist_id = ?
        AND run_id = ?
        AND event_type = ?
        AND proof_target_id = ?
        AND title = ?
        AND summary = ?
      ORDER BY created_at ASC
      LIMIT 1
    `,
    input.watchlistId,
    input.runId,
    input.eventType,
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
  const existingProofBackedCandidateId = await getExistingProofBackedEventCandidate(env, {
    watchlistId: input.watchlistId,
    runId: input.runId,
    eventType: input.eventType,
    proofTargetId: input.proofTargetId,
    title: input.title,
    summary: input.summary,
  });
  if (existingProofBackedCandidateId) {
    return existingProofBackedCandidateId;
  }

  const id = input.proofTargetId
    ? await createStableId("event_candidate", [
        input.watchlistId,
        input.runId,
        input.eventType,
        input.proofTargetId,
        input.title,
        input.summary,
      ])
    : createId();
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
    if (!input.proofTargetId || !isUniqueConstraintError(message)) {
      throw error;
    }
    const existingId = await getExistingProofBackedEventCandidate(env, {
      watchlistId: input.watchlistId,
      runId: input.runId,
      eventType: input.eventType,
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
