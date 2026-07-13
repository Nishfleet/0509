import {
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  toDeliveryAttemptRecord,
  type DeliveryAttemptRow,
} from "~/lib/data/delivery-records-rows.server";
import { createId, jsonValue, nowIso, type JsonRecord } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  DeliveryAttemptStatus,
  DeliveryChannel,
  DeliveryLane,
  WebhookReconciliationStatus,
} from "~/lib/types";

export async function listRetryableInstantAttempts(
  env: AppEnv,
  input: {
    since: string;
    limit: number;
  },
) {
  // Instant alerts that were deferred by quiet hours (and never flushed) or
  // failed at the provider. Successful re-sends update or supersede these
  // rows, so they naturally drop out of this query.
  const rows = await many<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE lane = 'customer'
        AND watchlist_id IS NOT NULL
        AND digest_run_id IS NULL
        AND created_at >= ?
        AND status IN ('skipped_due_to_quiet_hours', 'failed')
      ORDER BY created_at ASC
      LIMIT ?
    `,
    input.since,
    input.limit,
  );

  return rows.map(toDeliveryAttemptRecord);
}

export async function listStaleBillingLifecycleEmailAttempts(
  env: AppEnv,
  input: {
    staleBefore: string;
    limit: number;
  },
) {
  const rows = await many<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE lane = 'customer'
        AND channel = 'email'
        AND watchlist_id IS NULL
        AND digest_run_id IS NULL
        AND delivery_target_id IS NULL
        AND (
          idempotency_key LIKE 'billing-payment-issue:%'
          OR idempotency_key LIKE 'billing-cancellation:%'
          OR idempotency_key LIKE 'billing-refund:%'
        )
        AND status = 'pending'
        AND webhook_status = 'pending'
        AND updated_at <= ?
      ORDER BY updated_at ASC
      LIMIT ?
    `,
    input.staleBefore,
    input.limit,
  );

  return rows.map(toDeliveryAttemptRecord);
}

export async function listDeliveryAttempts(
  env: AppEnv,
  options: {
    userId?: string;
    watchlistId?: string;
    channel?: DeliveryChannel;
    targetValue?: string;
    limit?: number;
  } = {},
) {
  const clauses = ["1 = 1"];
  const bindings: unknown[] = [];
  if (options.userId) {
    clauses.push("user_id = ?");
    bindings.push(options.userId);
  }
  if (options.watchlistId) {
    clauses.push("watchlist_id = ?");
    bindings.push(options.watchlistId);
  }
  if (options.channel) {
    clauses.push("channel = ?");
    bindings.push(options.channel);
  }
  if (options.targetValue) {
    clauses.push("target_value = ?");
    bindings.push(options.targetValue);
  }

  const rows = await many<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    ...bindings,
    options.limit ?? 40,
  );

  return rows.map(toDeliveryAttemptRecord);
}

export async function getDeliveryAttemptByIdempotencyKey(
  env: AppEnv,
  idempotencyKey: string,
) {
  const row = await one<DeliveryAttemptRow>(
    env,
    "SELECT * FROM delivery_attempt WHERE idempotency_key = ?",
    idempotencyKey,
  );

  return row ? toDeliveryAttemptRecord(row) : null;
}

export async function reconcileDeliveryAttemptByProviderMessageId(
  env: AppEnv,
  input: {
    provider: string;
    providerMessageId: string;
    webhookStatus: WebhookReconciliationStatus;
    status?: DeliveryAttemptStatus | null;
    providerStatusLastSeenAt: string;
    errorMessage?: string | null;
  },
) {
  const existing = await one<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE provider = ?
        AND provider_message_id = ?
    `,
    input.provider,
    input.providerMessageId,
  );

  if (!existing) {
    return null;
  }

  const nextStatus = input.status ?? existing.status;
  const nextFailedAt =
    nextStatus === "failed" && !existing.failed_at
      ? input.providerStatusLastSeenAt
      : existing.failed_at;
  const nextSentAt =
    nextStatus === "sent" && !existing.sent_at
      ? input.providerStatusLastSeenAt
      : existing.sent_at;

  await run(
    env,
    `
      UPDATE delivery_attempt
      SET status = ?,
          webhook_status = ?,
          provider_status_last_seen_at = ?,
          error_message = COALESCE(?, error_message),
          sent_at = ?,
          failed_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
    nextStatus,
    input.webhookStatus,
    input.providerStatusLastSeenAt,
    input.errorMessage ?? null,
    nextSentAt,
    nextFailedAt,
    nowIso(),
    existing.id,
  );

  const updated = await one<DeliveryAttemptRow>(
    env,
    "SELECT * FROM delivery_attempt WHERE id = ?",
    existing.id,
  );

  return updated ? toDeliveryAttemptRecord(updated) : null;
}

export async function createDeliveryAttempt(
  env: AppEnv,
  input: {
    userId: string;
    watchlistId: string | null;
    digestRunId: string | null;
    deliveryTargetId: string | null;
    lane: DeliveryLane;
    channel: DeliveryChannel;
    provider: string;
    status: DeliveryAttemptStatus;
    webhookStatus: WebhookReconciliationStatus;
    targetValue: string;
    providerMessageId?: string | null;
    providerStatusLastSeenAt?: string | null;
    templateName?: string | null;
    eventIds?: string[];
    payloadSnapshot?: JsonRecord;
    idempotencyKey?: string | null;
    errorMessage?: string | null;
    sentAt?: string | null;
    failedAt?: string | null;
    timestamp?: string;
  },
) {
  const id = createId();
  const timestamp = input.timestamp ?? nowIso();
  await run(
    env,
    `
      INSERT INTO delivery_attempt (
        id,
        user_id,
        watchlist_id,
        digest_run_id,
        delivery_target_id,
        lane,
        channel,
        provider,
        status,
        webhook_status,
        target_value,
        provider_message_id,
        provider_status_last_seen_at,
        template_name,
        event_ids_json,
        payload_snapshot_json,
        idempotency_key,
        error_message,
        sent_at,
        failed_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.userId,
    input.watchlistId,
    input.digestRunId,
    input.deliveryTargetId,
    input.lane,
    input.channel,
    input.provider,
    input.status,
    input.webhookStatus,
    input.targetValue,
    input.providerMessageId ?? null,
    input.providerStatusLastSeenAt ?? null,
    input.templateName ?? null,
    jsonValue(input.eventIds ?? []),
    jsonValue(input.payloadSnapshot ?? {}),
    input.idempotencyKey ?? null,
    input.errorMessage ?? null,
    input.sentAt ?? null,
    input.failedAt ?? null,
    timestamp,
    timestamp,
  );

  return id;
}

export async function updateDeliveryAttemptResult(
  env: AppEnv,
  attemptId: string,
  input: {
    provider: string;
    status: DeliveryAttemptStatus;
    webhookStatus: WebhookReconciliationStatus;
    providerMessageId?: string | null;
    providerStatusLastSeenAt?: string | null;
    templateName?: string | null;
    errorMessage?: string | null;
    sentAt?: string | null;
    failedAt?: string | null;
    expectedStatus?: DeliveryAttemptStatus;
    expectedWebhookStatus?: WebhookReconciliationStatus;
    expectedUpdatedAt?: string;
    payloadSnapshot?: JsonRecord;
    updatedAt?: string;
  },
) {
  const payloadSnapshot = input.payloadSnapshot
    ? jsonValue(input.payloadSnapshot)
    : null;
  const result = await run(
    env,
    `
      UPDATE delivery_attempt
      SET provider = ?,
          status = ?,
          webhook_status = ?,
          provider_message_id = ?,
          provider_status_last_seen_at = ?,
          template_name = COALESCE(?, template_name),
          error_message = ?,
          sent_at = ?,
          failed_at = ?,
          payload_snapshot_json = COALESCE(?, payload_snapshot_json),
          updated_at = ?
      WHERE id = ?
        AND (? IS NULL OR status = ?)
        AND (? IS NULL OR webhook_status = ?)
        AND (? IS NULL OR updated_at = ?)
    `,
    input.provider,
    input.status,
    input.webhookStatus,
    input.providerMessageId ?? null,
    input.providerStatusLastSeenAt ?? null,
    input.templateName ?? null,
    input.errorMessage ?? null,
    input.sentAt ?? null,
    input.failedAt ?? null,
    payloadSnapshot,
    input.updatedAt ?? nowIso(),
    attemptId,
    input.expectedStatus ?? null,
    input.expectedStatus ?? null,
    input.expectedWebhookStatus ?? null,
    input.expectedWebhookStatus ?? null,
    input.expectedUpdatedAt ?? null,
    input.expectedUpdatedAt ?? null,
  );

  return Number(result.meta?.changes ?? 0) > 0;
}
