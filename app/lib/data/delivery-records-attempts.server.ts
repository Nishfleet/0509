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
import {
  hasTrustedInstantProviderRetryEvidence,
  isStalePreDispatchAttempt,
} from "~/lib/delivery-attempt-lease";
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
    stalePreDispatchBefore: string;
    limit: number;
  },
) {
  // Instant retries are fail-closed around every provider boundary: only
  // quiet hours, definite failed/failed outcomes, and expired pending/pending
  // pre-dispatch leases are eligible. provider_unknown is never auto-sent.
  const rows = await many<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE lane = 'customer'
        AND watchlist_id IS NOT NULL
        AND digest_run_id IS NULL
        AND idempotency_key LIKE 'instant:%'
        AND created_at >= ?
        AND (
          (
            status = 'skipped_due_to_quiet_hours'
            AND NOT EXISTS (
              SELECT 1
              FROM delivery_attempt AS dispatched_attempt
              WHERE dispatched_attempt.idempotency_key = CASE
                WHEN delivery_attempt.idempotency_key LIKE '%:quiet-hours'
                  THEN substr(
                    delivery_attempt.idempotency_key,
                    1,
                    length(delivery_attempt.idempotency_key) - length('quiet-hours')
                  ) || 'send'
                ELSE delivery_attempt.idempotency_key || ':send'
              END
            )
          )
          OR (
            channel = 'email'
            AND (
              (status = 'failed' AND webhook_status = 'failed')
              OR (
                status = 'pending'
                AND webhook_status = 'pending'
                AND updated_at <= ?
              )
            )
          )
          OR (
            channel IN ('whatsapp', 'slack')
            AND (
              (
                status = 'failed'
                AND webhook_status = 'failed'
                AND (
                  json_extract(payload_snapshot_json, '$.deliveryClaimProtocol') = 'instant_preclaim_v1'
                  OR (
                    json_extract(payload_snapshot_json, '$.instantAlertProviderEvidence.outcome') = 'failed'
                    AND NULLIF(TRIM(json_extract(payload_snapshot_json, '$.instantAlertProviderEvidence.reference')), '') IS NOT NULL
                    AND NULLIF(TRIM(json_extract(payload_snapshot_json, '$.instantAlertProviderEvidence.classification')), '') IS NOT NULL
                    AND NULLIF(TRIM(json_extract(payload_snapshot_json, '$.instantAlertProviderEvidence.observedAt')), '') IS NOT NULL
                  )
                )
              )
              OR (
                status = 'pending'
                AND webhook_status = 'pending'
                AND updated_at <= ?
                AND json_extract(payload_snapshot_json, '$.deliveryClaimProtocol') = 'instant_preclaim_v1'
              )
            )
          )
        )
      ORDER BY created_at ASC
      LIMIT ?
    `,
    input.since,
    input.stalePreDispatchBefore,
    input.stalePreDispatchBefore,
    input.limit,
  );

  return rows.map(toDeliveryAttemptRecord);
}

export async function listStaleBillingLifecycleEmailAttempts(
  env: AppEnv,
  input: {
    staleBefore: string;
    limit: number;
    maxRecoveryAttempts: number;
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
        AND (
          (
            status = 'pending'
            AND webhook_status = 'pending'
            AND updated_at <= ?
          )
          OR (
            status = 'failed'
            AND webhook_status = 'failed'
            AND provider_status_last_seen_at IS NOT NULL
            AND json_extract(
              payload_snapshot_json,
              '$.billingLifecycleProviderEvidence.outcome'
            ) = 'failed'
            AND NULLIF(TRIM(json_extract(
              payload_snapshot_json,
              '$.billingLifecycleProviderEvidence.reference'
            )), '') IS NOT NULL
            AND NULLIF(TRIM(json_extract(
              payload_snapshot_json,
              '$.billingLifecycleProviderEvidence.classification'
            )), '') IS NOT NULL
            AND NULLIF(TRIM(json_extract(
              payload_snapshot_json,
              '$.billingLifecycleProviderEvidence.observedAt'
            )), '') IS NOT NULL
            AND COALESCE(
              CAST(json_extract(payload_snapshot_json, '$.recoveryAttemptCount') AS INTEGER),
              0
            ) < ?
          )
        )
      ORDER BY updated_at ASC
      LIMIT ?
    `,
    input.staleBefore,
    input.maxRecoveryAttempts,
    input.limit,
  );

  return rows.map(toDeliveryAttemptRecord);
}

export async function listOutstandingBillingLifecycleProviderUnknownAttempts(
  env: AppEnv,
  options: { limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 100)));
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
        AND webhook_status = 'provider_unknown'
        AND (
          status = 'pending'
          OR status = 'sent'
          OR (status = 'failed' AND provider_status_last_seen_at IS NOT NULL)
        )
        AND (
          idempotency_key LIKE 'billing-payment-issue:%'
          OR idempotency_key LIKE 'billing-cancellation:%'
          OR idempotency_key LIKE 'billing-refund:%'
        )
      ORDER BY created_at ASC
      LIMIT ?
    `,
    limit,
  );
  return rows.map(toDeliveryAttemptRecord);
}

export async function listOutstandingDigestProviderUnknownAttempts(
  env: AppEnv,
  options: { limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 100)));
  const rows = await many<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE lane = 'customer'
        AND channel = 'email'
        AND digest_run_id IS NOT NULL
        AND delivery_target_id IS NOT NULL
        AND webhook_status = 'provider_unknown'
        AND (
          status = 'pending'
          OR status = 'sent'
          OR (status = 'failed' AND provider_status_last_seen_at IS NOT NULL)
        )
        AND idempotency_key LIKE 'digest:%:customer:email:%'
      ORDER BY created_at ASC
      LIMIT ?
    `,
    limit,
  );
  return rows.map(toDeliveryAttemptRecord);
}

export async function listOutstandingInstantProviderUnknownAttempts(
  env: AppEnv,
  options: { limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 100)));
  const rows = await many<DeliveryAttemptRow>(
    env,
    `
      SELECT *
      FROM delivery_attempt
      WHERE lane = 'customer'
        AND channel IN ('email', 'whatsapp', 'slack')
        AND watchlist_id IS NOT NULL
        AND digest_run_id IS NULL
        AND delivery_target_id IS NOT NULL
        AND (
          (
            webhook_status = 'provider_unknown'
            AND (
              status = 'failed'
              OR (channel = 'email' AND status = 'sent')
              OR (
                status = 'pending'
                AND (channel = 'email' OR julianday(updated_at) <= julianday('now', '-60 seconds'))
              )
            )
          )
          OR (
            channel IN ('whatsapp', 'slack')
            AND status = 'failed'
            AND webhook_status = 'failed'
            AND COALESCE(
              json_extract(payload_snapshot_json, '$.deliveryClaimProtocol'),
              ''
            ) != 'instant_preclaim_v1'
            AND COALESCE(
              json_extract(payload_snapshot_json, '$.instantAlertProviderEvidence.outcome'),
              ''
            ) != 'failed'
          )
        )
        AND (
          (channel = 'email'
            AND provider = 'cloudflare_email'
            AND idempotency_key LIKE 'instant:%:customer:email:%')
          OR (channel = 'whatsapp'
            AND provider = 'whatsapp_cloud_api'
            AND idempotency_key LIKE 'instant:%:customer:whatsapp:%')
          OR (channel = 'slack'
            AND provider = 'slack_incoming_webhook'
            AND idempotency_key LIKE 'instant:%:customer:slack:%')
        )
      ORDER BY
        CASE
          WHEN status = 'pending' THEN 0
          WHEN status = 'failed' THEN 1
          ELSE 2
        END,
        created_at ASC
      LIMIT ?
    `,
    limit,
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
  watchlistId: string | null;
  deliveryTargetId: string | null;
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
  const targetValue = normalizeAttemptTargetValue(input.channel, input.targetValue);
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

    const retryEvidenceIsTrusted =
      input.channel === "email" ||
      hasTrustedInstantProviderRetryEvidence(existing);
    const stalePreDispatch =
      retryEvidenceIsTrusted && isStalePreDispatchAttempt(existing);
    const definiteFailure =
      retryEvidenceIsTrusted &&
      existing.status === "failed" &&
      existing.webhookStatus === "failed";
    if (!definiteFailure && !stalePreDispatch) {
      return {
        attemptId: null,
        claimUpdatedAt: null,
        duplicate: existing,
        reclaimed: false,
      };
    }

    const claimUpdatedAt = nowIso();
    const expectedStatus = stalePreDispatch ? "pending" : "failed";
    const expectedWebhookStatus = stalePreDispatch ? "pending" : "failed";
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
      targetValue,
      deliveryTargetId: input.deliveryTargetId,
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
      targetValue,
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
        AND (
          lane <> 'customer'
          OR EXISTS (
            SELECT 1
            FROM delivery_target AS target
            WHERE target.id = delivery_attempt.delivery_target_id
              AND target.user_id = delivery_attempt.user_id
              AND target.channel = delivery_attempt.channel
              AND (
                (
                  delivery_attempt.channel = 'email'
                  AND lower(trim(target.target_value)) =
                    lower(trim(delivery_attempt.target_value))
                )
                OR (
                  delivery_attempt.channel <> 'email'
                  AND target.target_value = delivery_attempt.target_value
                )
              )
              AND target.is_opted_in = 1
              AND target.is_paused = 0
              AND target.opted_out_at IS NULL
              AND target.is_validated = 1
              AND target.validation_status = 'validated'
              AND (
                delivery_attempt.channel <> 'whatsapp'
                OR target.template_eligible = 1
              )
              AND (
                delivery_attempt.channel <> 'email'
                OR EXISTS (
                  SELECT 1
                  FROM user AS account
                  WHERE account.id = target.user_id
                    AND account.emailVerified = 1
                    AND lower(trim(account.email)) = lower(trim(target.target_value))
                )
              )
          )
        )
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

  const incomingSeenAt = Date.parse(input.providerStatusLastSeenAt);
  const existingSeenAt = existing.provider_status_last_seen_at
    ? Date.parse(existing.provider_status_last_seen_at)
    : Number.NEGATIVE_INFINITY;
  const existingTerminal =
    existing.webhook_status === "delivered" || existing.webhook_status === "failed";

  if (
    !Number.isFinite(incomingSeenAt) ||
    incomingSeenAt < existingSeenAt ||
    (existingTerminal && input.webhookStatus !== existing.webhook_status)
  ) {
    return toDeliveryAttemptRecord(existing);
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
        AND status = ?
        AND webhook_status = ?
        AND (
          (provider_status_last_seen_at IS NULL AND ? IS NULL)
          OR provider_status_last_seen_at = ?
        )
        AND updated_at = ?
    `,
    nextStatus,
    input.webhookStatus,
    input.providerStatusLastSeenAt,
    input.errorMessage ?? null,
    nextSentAt,
    nextFailedAt,
    nowIso(),
    existing.id,
    existing.status,
    existing.webhook_status,
    existing.provider_status_last_seen_at,
    existing.provider_status_last_seen_at,
    existing.updated_at,
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
  const targetValue = normalizeAttemptTargetValue(input.channel, input.targetValue);
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
    targetValue,
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

function normalizeAttemptTargetValue(channel: DeliveryChannel, value: string) {
  return channel === "email" ? value.trim().toLowerCase() : value;
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

const BILLING_LIFECYCLE_OUTBOX_AFTER_MUTATION_SQL = `
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
  WHERE changes() > 0
`;

const BILLING_LIFECYCLE_OUTBOX_AFTER_LEDGER_SQL = `
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
  WHERE EXISTS (
    SELECT 1 FROM dodo_webhook_event
    WHERE event_id = ? AND outcome = 'processed' AND processed_at = ?
  )
`;

export function buildBillingLifecycleOutboxStatement(
  db: ReturnType<typeof ensureDb>,
  spec: BillingLifecycleEmailOutboxSpec,
  gate: BillingLifecycleOutboxGate,
  timestamp: string,
) {
  const statement = db.prepare(
    gate.kind === "prior-statement-changed"
      ? BILLING_LIFECYCLE_OUTBOX_AFTER_MUTATION_SQL
      : BILLING_LIFECYCLE_OUTBOX_AFTER_LEDGER_SQL,
  );
  const gateBindings =
    gate.kind === "prior-statement-changed" ? [] : [gate.eventId, gate.processedAt];

  // INSERT OR IGNORE: the unique idempotency index arbitrates duplicates
  // (redeliveries, racing sibling events, an existing failed/sent row). A
  // plain INSERT conflict would abort the whole batch and roll back the plan
  // mutation itself.
  return statement.bind(
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
    deliveryTargetId?: string | null;
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
          delivery_target_id = COALESCE(delivery_target_id, ?),
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
    input.deliveryTargetId ?? null,
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
