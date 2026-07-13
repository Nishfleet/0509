/**
 * Digest-run / digest-item / digest-delivery D1 persistence.
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Does not include email HTML or sender paths.
 */

import {
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  createId,
  jsonValue,
  nowIso,
  parseJson,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  DigestDeliveryRecord,
  DigestItemRecord,
  DigestRecord,
  WatchEventType,
} from "~/lib/types";

interface DigestRunRow {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  created_at: string;
}

interface DigestItemRow {
  id: string;
  digest_run_id: string;
  watchlist_id: string;
  watchlist_name: string;
  event_type: WatchEventType;
  title: string;
  summary: string;
  metadata_json: string;
  created_at: string;
}

interface DigestDeliveryRow {
  id: string;
  digest_run_id: string;
  provider: string;
  status: DigestDeliveryRecord["status"];
  recipient_email: string;
  external_message_id: string | null;
  error_message: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

function toDigestItemRecord(row: DigestItemRow): DigestItemRecord {
  return {
    id: row.id,
    digestRunId: row.digest_run_id,
    watchlistId: row.watchlist_id,
    watchlistName: row.watchlist_name,
    eventType: row.event_type,
    title: row.title,
    summary: row.summary,
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function toDigestDeliveryRecord(row: DigestDeliveryRow): DigestDeliveryRecord {
  return {
    id: row.id,
    digestRunId: row.digest_run_id,
    provider: row.provider,
    status: row.status,
    recipientEmail: row.recipient_email,
    externalMessageId: row.external_message_id,
    errorMessage: row.error_message,
    deliveredAt: row.delivered_at,
  };
}

export async function createDigestRun(
  env: AppEnv,
  userId: string,
  periodStart: string,
  periodEnd: string,
  summary: JsonRecord,
) {
  const id = createId();
  await run(
    env,
    `
      INSERT OR IGNORE INTO digest_run (
        id,
        user_id,
        period_start,
        period_end,
        summary_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    id,
    userId,
    periodStart,
    periodEnd,
    jsonValue(summary),
    nowIso(),
  );

  const row = await one<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
        AND period_start = ?
        AND period_end = ?
      LIMIT 1
    `,
    userId,
    periodStart,
    periodEnd,
  );

  return row?.id ?? id;
}

export async function clearDigestItems(env: AppEnv, digestRunId: string) {
  await run(env, "DELETE FROM digest_item WHERE digest_run_id = ?", digestRunId);
}

export async function addDigestItem(
  env: AppEnv,
  digestRunId: string,
  input: {
    watchlistId: string;
    watchlistName: string;
    eventType: WatchEventType;
    title: string;
    summary: string;
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      INSERT INTO digest_item (
        id,
        digest_run_id,
        watchlist_id,
        watchlist_name,
        event_type,
        title,
        summary,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    createId(),
    digestRunId,
    input.watchlistId,
    input.watchlistName,
    input.eventType,
    input.title,
    input.summary,
    jsonValue(input.metadata ?? {}),
    nowIso(),
  );
}

export async function upsertDigestDelivery(
  env: AppEnv,
  digestRunId: string,
  input: Omit<DigestDeliveryRecord, "id" | "digestRunId">,
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO digest_delivery (
        id,
        digest_run_id,
        provider,
        status,
        recipient_email,
        external_message_id,
        error_message,
        delivered_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(digest_run_id)
      DO UPDATE SET provider = excluded.provider,
                    status = excluded.status,
                    recipient_email = excluded.recipient_email,
                    external_message_id = excluded.external_message_id,
                    error_message = excluded.error_message,
                    delivered_at = excluded.delivered_at,
                    updated_at = excluded.updated_at
    `,
    createId(),
    digestRunId,
    input.provider,
    input.status,
    input.recipientEmail,
    input.externalMessageId,
    input.errorMessage,
    input.deliveredAt,
    timestamp,
    timestamp,
  );
}

const DIGEST_RUN_LIST_LIMIT = 60;

export async function listDigests(
  env: AppEnv,
  userId: string,
  limit: number = DIGEST_RUN_LIST_LIMIT,
) {
  const runs = await many<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
      ORDER BY period_end DESC
      LIMIT ?
    `,
    userId,
    limit,
  );

  if (runs.length === 0) {
    return [];
  }

  // Join through digest_run instead of expanding run ids into `IN (?, ...)`:
  // D1 caps bound parameters at 100, so long-tenured users with many digest
  // runs would otherwise break this query permanently. Rows from runs that
  // tie on the oldest period_end but fall outside `runs` are ignored by the
  // run-id maps below.
  const oldestPeriodEnd = runs[runs.length - 1]!.period_end;
  const [items, deliveries] = await Promise.all([
    many<DigestItemRow>(
      env,
      `
        SELECT digest_item.*
        FROM digest_item
        INNER JOIN digest_run ON digest_run.id = digest_item.digest_run_id
        WHERE digest_run.user_id = ? AND digest_run.period_end >= ?
        ORDER BY digest_item.created_at ASC
      `,
      userId,
      oldestPeriodEnd,
    ),
    many<DigestDeliveryRow>(
      env,
      `
        SELECT digest_delivery.*
        FROM digest_delivery
        INNER JOIN digest_run ON digest_run.id = digest_delivery.digest_run_id
        WHERE digest_run.user_id = ? AND digest_run.period_end >= ?
      `,
      userId,
      oldestPeriodEnd,
    ),
  ]);
  const itemsByDigestId = new Map<string, DigestItemRow[]>();
  const deliveryByDigestId = new Map<string, DigestDeliveryRow>();

  for (const item of items) {
    const group = itemsByDigestId.get(item.digest_run_id) ?? [];
    group.push(item);
    itemsByDigestId.set(item.digest_run_id, group);
  }

  for (const delivery of deliveries) {
    deliveryByDigestId.set(delivery.digest_run_id, delivery);
  }

  return runs.map((run) => {
    const delivery = deliveryByDigestId.get(run.id) ?? null;
    return {
      id: run.id,
      userId: run.user_id,
      periodStart: run.period_start,
      periodEnd: run.period_end,
      createdAt: run.created_at,
      items: (itemsByDigestId.get(run.id) ?? []).map(toDigestItemRecord),
      delivery: delivery ? toDigestDeliveryRecord(delivery) : null,
    };
  });
}

export async function getDigest(env: AppEnv, digestRunId: string) {
  const run = await one<DigestRunRow>(env, "SELECT * FROM digest_run WHERE id = ?", digestRunId);
  if (!run) {
    return null;
  }
  const [items, delivery] = await Promise.all([
    many<DigestItemRow>(
      env,
      "SELECT * FROM digest_item WHERE digest_run_id = ? ORDER BY created_at ASC",
      digestRunId,
    ),
    one<DigestDeliveryRow>(env, "SELECT * FROM digest_delivery WHERE digest_run_id = ?", digestRunId),
  ]);

  return {
    id: run.id,
    userId: run.user_id,
    periodStart: run.period_start,
    periodEnd: run.period_end,
    createdAt: run.created_at,
    items: items.map(toDigestItemRecord),
    delivery: delivery ? toDigestDeliveryRecord(delivery) : null,
  } satisfies DigestRecord;
}

export async function getDigestByPeriod(
  env: AppEnv,
  userId: string,
  periodStart: string,
  periodEnd: string,
) {
  const row = await one<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
        AND period_start = ?
        AND period_end = ?
      LIMIT 1
    `,
    userId,
    periodStart,
    periodEnd,
  );

  if (!row) {
    return null;
  }

  return getDigest(env, row.id);
}

export async function listRetryableDigestRuns(
  env: AppEnv,
  input: {
    since: string;
    limit: number;
  },
) {
  const rows = await many<
    DigestRunRow & { user_email: string; user_name: string }
  >(
    env,
    `
      SELECT digest_run.*, user.email AS user_email, user.name AS user_name
      FROM digest_run
      INNER JOIN user ON user.id = digest_run.user_id
      LEFT JOIN digest_delivery ON digest_delivery.digest_run_id = digest_run.id
      WHERE digest_run.period_end >= ?
        AND (
          digest_delivery.status = 'failed'
          OR digest_delivery.id IS NULL
        )
      ORDER BY digest_run.period_end ASC
      LIMIT ?
    `,
    input.since,
    input.limit,
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  }));
}
