import {
  ensureDb,
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  toDeliveryAttemptRecord,
  type DeliveryAttemptRow,
} from "~/lib/data/delivery-records-rows.server";
import { createId, jsonValue, nowIso, type JsonRecord } from "~/lib/data/helpers.server";
import { isStalePreDispatchAttempt } from "~/lib/delivery-attempt-lease";
import type { AppEnv } from "~/lib/env.server";
import type {
  DeliveryAttemptRecord,
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

export interface InstantDeliveryAttemptClaimInput {
  userId: string;
  watchlistId: string;
  deliveryTargetId: string;
  lane: DeliveryLane;
  channel: DeliveryChannel;
  provider: string;
  targetValue: string;
  eventIds: string[];
  payloadSnapshot: JsonRecord;
  idempotencyKey: string;
  templateName?: string | null;
  deferredByQuietHours?: boolean;
}

/**
 * Atomically claims an instant delivery attempt before provider I/O. The
 * idempotency unique index arbitrates initial races; failed and stale pending
 * rows are re-armed with an exact-version CAS so only one retry owner wins.
 */
export async function claimInstantDeliveryAttempt(
  env: AppEnv,
  input: InstantDeliveryAttemptClaimInput,
): Promise<{
  attemptId: string | null;
  claimUpdatedAt: string | null;
  duplicate: DeliveryAttemptRecord | null;
  reclaimed: boolean;
}> {
  const existing = await getDeliveryAttemptByIdempotencyKey(
    env,
    input.idempotencyKey,
  );
  const quietHours = input.deferredByQuietHours === true;
  if (existing) {
    if (quietHours) {
      return {
        attemptId: null,
        claimUpdatedAt: null,
        duplicate: existing,
        reclaimed: false,
      };
    }

    const stalePreDispatch = isStalePreDispatchAttempt(existing);
    if (existing.status !== "failed" && !stalePreDispatch) {
      return {
        attemptId: null,
        claimUpdatedAt: null,
        duplicate: existing,
        reclaimed: false,
      };
    }

    const claimUpdatedAt = nowIso();
    const expectedStatus = stalePreDispatch ? "pending" : "failed";
    const expectedWebhookStatus = stalePreDispatch
      ? "pending"
      : existing.webhookStatus;
    const reclaimed = await updateDeliveryAttemptResult(env, existing.id, {
      provider: input.provider,
      status: "pending",
      webhookStatus: "pending",
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: input.templateName ?? null,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      payloadSnapshot: input.payloadSnapshot,
      targetValue: input.targetValue,
      updatedAt: claimUpdatedAt,
      expectedStatus,
      expectedWebhookStatus,
      expectedUpdatedAt: existing.updatedAt,
    });
    if (reclaimed !== false) {
      return {
        attemptId: existing.id,
        claimUpdatedAt,
        duplicate: null,
        reclaimed: true,
      };
    }

    const concurrent = await getDeliveryAttemptByIdempotencyKey(
      env,
      input.idempotencyKey,
    );
    return {
      attemptId: null,
      claimUpdatedAt: null,
      duplicate: concurrent ?? existing,
      reclaimed: false,
    };
  }

  const claimUpdatedAt = nowIso();
  try {
    const attemptId = await createDeliveryAttempt(env, {
      userId: input.userId,
      watchlistId: input.watchlistId,
      digestRunId: null,
      deliveryTargetId: input.deliveryTargetId,
      lane: input.lane,
      channel: input.channel,
      provider: input.provider,
      status: quietHours ? "skipped_due_to_quiet_hours" : "pending",
      webhookStatus: quietHours ? "provider_unknown" : "pending",
      targetValue: input.targetValue,
      providerMessageId: null,
      providerStatusLastSeenAt: null,
      templateName: input.templateName ?? null,
      eventIds: input.eventIds,
      payloadSnapshot: input.payloadSnapshot,
      idempotencyKey: input.idempotencyKey,
      errorMessage: null,
      sentAt: null,
      failedAt: null,
      timestamp: claimUpdatedAt,
    });
    return {
      attemptId,
      claimUpdatedAt: quietHours ? null : claimUpdatedAt,
      duplicate: null,
      reclaimed: false,
    };
  } catch (error) {
    // A concurrent INSERT may win between the initial read and our INSERT.
    // Return its durable row and never let this execution call a provider.
    const concurrent = await getDeliveryAttemptByIdempotencyKey(
      env,
      input.idempotencyKey,
    );
    if (concurrent) {
      return {
        attemptId: null,
        claimUpdatedAt: null,
        duplicate: concurrent,
        reclaimed: false,
      };
    }
    throw error;
  }
}

/**
 * Moves an owned pre-dispatch claim into an at-most-once state immediately
 * before provider I/O. A crash after this point leaves provider outcome
 * unknown and must never be reclaimed automatically.
 */
export async function markInstantDeliveryDispatchStarted(
  env: AppEnv,
  attemptId: string,
  expectedUpdatedAt: string,
) {
  const dispatchStartedAt = nowIso();
  const result = await run(
    env,
    `
      UPDATE delivery_attempt
      SET webhook_status = 'provider_unknown',
          updated_at = ?
      WHERE id = ?
        AND status = 'pending'
        AND webhook_status = 'pending'
        AND updated_at = ?
    `,
    dispatchStartedAt,
    attemptId,
    expectedUpdatedAt,
  );

  return Number(result.meta?.changes ?? 0) > 0 ? dispatchStartedAt : null;
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

/**
 * A billing lifecycle email the webhook route wants enqueued atomically with
 * the plan mutation + ledger finalize. Content is frozen at enqueue time; the
 * `outboxPendingDispatch` marker in payloadSnapshot tells the dispatch/
 * recovery paths that this row was created pre-dispatch inside the batch.
 */
export interface BillingLifecycleEmailOutboxSpec {
  userId: string;
  email: string;
  idempotencyKey: string;
  templateName: string;
  payloadSnapshot: JsonRecord;
}

export type BillingLifecycleOutboxGate =
  /**
   * Insert only when the immediately preceding statement in the batch changed
   * rows (SQLite changes()). Place DIRECTLY after the business mutation.
   */
  | { kind: "prior-statement-changed" }
  /**
   * Insert only when THIS batch finalized the ledger row as processed
   * (matched by the batch's own processedAt). Safe anywhere after the
   * conditional finalize statement.
   */
  | { kind: "ledger-processed"; eventId: string; processedAt: string };

export function buildBillingLifecycleOutboxStatement(
  db: ReturnType<typeof ensureDb>,
  spec: BillingLifecycleEmailOutboxSpec,
  gate: BillingLifecycleOutboxGate,
  timestamp: string,
) {
  const gateSql =
    gate.kind === "prior-statement-changed"
      ? "changes() > 0"
      : `EXISTS (
          SELECT 1 FROM dodo_webhook_event
          WHERE event_id = ? AND outcome = 'processed' AND processed_at = ?
        )`;
  const gateBindings =
    gate.kind === "prior-statement-changed" ? [] : [gate.eventId, gate.processedAt];

  // INSERT OR IGNORE: the unique idempotency index arbitrates duplicates
  // (redeliveries, racing sibling events, an existing failed/sent row). A
  // plain INSERT conflict would abort the whole batch and roll back the plan
  // mutation itself.
  return db.prepare(`
      INSERT OR IGNORE INTO delivery_attempt (
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
      SELECT ?, ?, NULL, NULL, NULL, 'customer', 'email', ?, 'pending', 'pending', ?,
             NULL, NULL, ?, '[]', ?, ?, NULL, NULL, NULL, ?, ?
      WHERE ${gateSql}
    `).bind(
    createId(),
    spec.userId,
    "cloudflare_email",
    spec.email,
    spec.templateName,
    jsonValue(spec.payloadSnapshot),
    spec.idempotencyKey,
    timestamp,
    timestamp,
    ...gateBindings,
  );
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
    targetValue?: string;
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
          target_value = COALESCE(?, target_value),
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
    input.targetValue ?? null,
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
