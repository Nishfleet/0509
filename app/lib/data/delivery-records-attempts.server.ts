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
					OR (
						status = 'failed'
						AND provider_status_last_seen_at IS NOT NULL
					)
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

	const incomingSeenAt = Date.parse(input.providerStatusLastSeenAt);
	const existingSeenAt = existing.provider_status_last_seen_at
		? Date.parse(existing.provider_status_last_seen_at)
		: Number.NEGATIVE_INFINITY;
	const existingTerminal =
		existing.webhook_status === "delivered" || existing.webhook_status === "failed";

	if (
		!Number.isFinite(incomingSeenAt)
		|| incomingSeenAt < existingSeenAt
		|| (existingTerminal && input.webhookStatus !== existing.webhook_status)
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
