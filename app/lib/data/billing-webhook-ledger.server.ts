import {
  ensureDb,
  execute as run,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  jsonValue,
  nowIso,
  type JsonRecord,
} from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";

export const DODO_WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export type DodoWebhookLedgerOutcome = "processed" | "ignored";

export interface DodoWebhookLedgerFinalize {
  eventId: string;
  outcome: DodoWebhookLedgerOutcome;
  metadata: JsonRecord;
}

export type DodoLifecycleEmailRetryKind =
	| "payment_issue"
	| "cancellation_scheduled"
	| "revoke"
	| "refund";

export interface DodoLifecycleEmailRetryClaim {
	kind: DodoLifecycleEmailRetryKind;
	userId: string;
	idempotencyKey: string;
}

export type DodoWebhookProcessingClaim =
	| { status: "claimed"; lifecycleEmailRetry?: DodoLifecycleEmailRetryClaim }
  | { status: "duplicate"; outcome: "processed" | "ignored" }
  | { status: "in_progress" }
  | { status: "deferred" };

export type DodoBillingCanaryClaimGuard =
  | "acquire_lock"
  | "defer_while_locked"
  | "require_lock";

function dodoWebhookProcessingLeaseDays() {
  return DODO_WEBHOOK_PROCESSING_LEASE_MS / (24 * 60 * 60 * 1000);
}

function lifecycleEmailRetryFromMetadata(
	value: string | null | undefined,
): DodoLifecycleEmailRetryClaim | null {
	if (!value) return null;
	try {
		const metadata = JSON.parse(value) as Record<string, unknown>;
		const kind = metadata.kind;
		const userId = typeof metadata.userId === "string" ? metadata.userId.trim() : "";
		const idempotencyKey =
			typeof metadata.idempotencyKey === "string" ? metadata.idempotencyKey.trim() : "";
		if (
			metadata.action !== "lifecycle_email_retry" ||
			(kind !== "payment_issue" &&
				kind !== "cancellation_scheduled" &&
				kind !== "revoke" &&
				kind !== "refund") ||
			!userId ||
			!idempotencyKey
		) {
			return null;
		}

		const expectedPrefix =
			kind === "payment_issue"
        ? `billing-payment-issue:${userId}:`
				: kind === "refund"
          ? `billing-refund:${userId}:`
          : `billing-cancellation:${userId}:`;
		return idempotencyKey.startsWith(expectedPrefix)
			? { kind, userId, idempotencyKey }
			: null;
	} catch {
		return null;
	}
}

export function buildDodoWebhookLedgerFinalizeStatement(
  db: ReturnType<typeof ensureDb>,
  ledger: DodoWebhookLedgerFinalize,
  processedAt: string,
) {
  return db.prepare(`
      UPDATE dodo_webhook_event
      SET outcome = ?,
          processed_at = ?,
          processing_started_at = NULL,
          metadata_json = ?
      WHERE event_id = ?
        AND outcome = 'processing'
    `).bind(
    ledger.outcome,
    processedAt,
    jsonValue(ledger.metadata),
    ledger.eventId,
  );
}

export function buildDodoWebhookLedgerFinalizeAfterChangedStatement(
  db: ReturnType<typeof ensureDb>,
  ledger: DodoWebhookLedgerFinalize,
  processedAt: string,
) {
  return db.prepare(`
      UPDATE dodo_webhook_event
      SET outcome = ?,
          processed_at = ?,
          processing_started_at = NULL,
          metadata_json = ?
      WHERE event_id = ?
        AND outcome = 'processing'
        AND changes() > 0
    `).bind(
    ledger.outcome,
    processedAt,
    jsonValue(ledger.metadata),
    ledger.eventId,
  );
}


export async function finalizeDodoWebhookLedgerOnly(
  env: AppEnv,
  ledger: DodoWebhookLedgerFinalize,
) {
  const db = ensureDb(env);
  await db.batch([buildDodoWebhookLedgerFinalizeStatement(db, ledger, nowIso())]);
}


export async function beginDodoWebhookEventProcessing(
  env: AppEnv,
  input: {
    eventId: string;
    eventType: string;
    userId: string | null;
    payloadTimestamp: string | null;
    billingCanaryGuard?: DodoBillingCanaryClaimGuard;
    billingCanaryLockId?: string;
  },
): Promise<DodoWebhookProcessingClaim> {
  const eventId = input.eventId.trim();
  if (!eventId) {
    throw new Error("Dodo webhook event id is required.");
  }

  const db = ensureDb(env);
  const receivedAt = nowIso();
  const leaseDays = dodoWebhookProcessingLeaseDays();
  if (input.billingCanaryGuard && !input.userId) {
    throw new Error("Billing canary ledger guards require a user id.");
  }
  if (input.billingCanaryGuard === "require_lock" && !input.billingCanaryLockId?.trim()) {
    throw new Error("Internal billing canary claims require an exact lock id.");
  }
  const activeLeaseSql = `
    outcome = 'processing'
    AND processing_started_at IS NOT NULL
    AND julianday(?) <= julianday(processing_started_at) + ?
  `;
  const guardSql = input.billingCanaryGuard === "acquire_lock"
    ? `NOT EXISTS (
        SELECT 1 FROM dodo_webhook_event AS active_event
        WHERE active_event.user_id = ?
          AND active_event.event_id <> ?
          AND active_event.${activeLeaseSql}
      )`
    : input.billingCanaryGuard === "defer_while_locked"
      ? `NOT EXISTS (
          SELECT 1 FROM dodo_webhook_event AS canary_lock
          WHERE canary_lock.user_id = ?
            AND canary_lock.event_type = 'billing.canary.lock'
            AND (
              json_extract(canary_lock.metadata_json, '$.action') = 'billing_canary_active'
              OR canary_lock.${activeLeaseSql}
            )
        )`
      : input.billingCanaryGuard === "require_lock"
        ? `EXISTS (
            SELECT 1 FROM dodo_webhook_event AS canary_lock
            WHERE canary_lock.user_id = ?
              AND canary_lock.event_id = ?
              AND canary_lock.event_type = 'billing.canary.lock'
              AND canary_lock.${activeLeaseSql}
          )`
        : "1 = 1";
  const guardBindings = input.billingCanaryGuard === "acquire_lock"
    ? [input.userId, eventId, receivedAt, leaseDays]
    : input.billingCanaryGuard === "require_lock"
      ? [input.userId, input.billingCanaryLockId!.trim(), receivedAt, leaseDays]
      : input.billingCanaryGuard
      ? [input.userId, receivedAt, leaseDays]
      : [];
  const reclaimWhere = `
    dodo_webhook_event.outcome = 'failed'
    OR (
      dodo_webhook_event.outcome IN ('received', 'processing')
      AND (
        dodo_webhook_event.processing_started_at IS NULL
        OR julianday(?) > julianday(dodo_webhook_event.processing_started_at) + ?
      )
    )
  `;

  let result: D1Result;
  try {
    result = await db.prepare(`
      INSERT INTO dodo_webhook_event (
        event_id,
        event_type,
        user_id,
        received_at,
        payload_timestamp,
        outcome,
        processing_started_at,
        metadata_json
      )
      SELECT ?, ?, ?, ?, ?, 'processing', ?, '{}'
      WHERE ${guardSql}
      ON CONFLICT(event_id)
      DO UPDATE SET
        event_type = excluded.event_type,
        user_id = excluded.user_id,
        received_at = excluded.received_at,
        payload_timestamp = excluded.payload_timestamp,
        outcome = 'processing',
        processing_started_at = excluded.processing_started_at,
        processed_at = NULL,
        metadata_json = CASE
          WHEN dodo_webhook_event.outcome = 'failed'
            THEN dodo_webhook_event.metadata_json
          -- A redelivery that claimed an armed 'failed' row carries the
          -- lifecycle-email retry claim forward into 'processing'. If that
          -- worker dies mid-run, the next lease-expiry reclaim must keep the
          -- claim too — wiping it here would reprocess the event as a no-op
          -- grant with no retry context and drop the customer email.
          WHEN json_extract(dodo_webhook_event.metadata_json, '$.action') = 'lifecycle_email_retry'
            THEN dodo_webhook_event.metadata_json
          ELSE '{}'
        END
      WHERE (${reclaimWhere})
        AND ${guardSql}
    `).bind(
      eventId,
      input.eventType,
      input.userId,
      receivedAt,
      input.payloadTimestamp,
      receivedAt,
      ...guardBindings,
      receivedAt,
      leaseDays,
      ...guardBindings,
    ).run();
  } catch (error) {
    if (!isMissingDodoPayloadTimestampColumnError(error) && !isMissingDodoProcessingLeaseColumnError(error)) {
      throw error;
    }

    if (isMissingDodoPayloadTimestampColumnError(error)) {
      try {
        result = await db.prepare(`
          INSERT INTO dodo_webhook_event (
            event_id,
            event_type,
            user_id,
            received_at,
            outcome,
            processing_started_at,
            metadata_json
          )
          SELECT ?, ?, ?, ?, 'processing', ?, '{}'
          WHERE ${guardSql}
          ON CONFLICT(event_id)
          DO UPDATE SET
            event_type = excluded.event_type,
            user_id = excluded.user_id,
            received_at = excluded.received_at,
            outcome = 'processing',
            processing_started_at = excluded.processing_started_at,
            processed_at = NULL,
            metadata_json = CASE
              WHEN dodo_webhook_event.outcome = 'failed'
                THEN dodo_webhook_event.metadata_json
              WHEN json_extract(dodo_webhook_event.metadata_json, '$.action') = 'lifecycle_email_retry'
                THEN dodo_webhook_event.metadata_json
              ELSE '{}'
            END
          WHERE (${reclaimWhere})
            AND ${guardSql}
        `).bind(
          eventId,
          input.eventType,
          input.userId,
          receivedAt,
          receivedAt,
          ...guardBindings,
          receivedAt,
          leaseDays,
          ...guardBindings,
        ).run();
      } catch (fallbackError) {
        throw fallbackError;
      }
    } else {
      throw error;
    }
  }

  if (Number(result.meta?.changes ?? 0) > 0) {
		// Failed-row metadata is preserved by the successful compare-and-set
		// above, so the retry classification is read from the row we actually
		// claimed rather than from a racy pre-claim snapshot.
		const claimed = await one<{ metadata_json: string }>(
			env,
			"SELECT metadata_json FROM dodo_webhook_event WHERE event_id = ?",
			eventId,
		);
		const lifecycleEmailRetry = lifecycleEmailRetryFromMetadata(claimed?.metadata_json);
		return lifecycleEmailRetry
			? { status: "claimed", lifecycleEmailRetry }
			: { status: "claimed" };
  }

  const row = await one<{
    outcome: string;
    active_lease: number;
  }>(
    env,
    `SELECT
       outcome,
       CASE
         WHEN outcome = 'processing'
           AND processing_started_at IS NOT NULL
           AND julianday(?) <= julianday(processing_started_at) + ?
         THEN 1
         ELSE 0
       END AS active_lease
     FROM dodo_webhook_event
     WHERE event_id = ?`,
    receivedAt,
    leaseDays,
    eventId,
  );
  if (row?.outcome === "processed" || row?.outcome === "ignored") {
    return { status: "duplicate", outcome: row.outcome };
  }
  if (!row && input.billingCanaryGuard) {
    return { status: "deferred" };
  }
  if (row?.outcome === "failed" && input.billingCanaryGuard) {
    return { status: "deferred" };
  }
  if (
    input.billingCanaryGuard &&
    (row?.outcome === "received" || row?.outcome === "processing") &&
    Number(row.active_lease) !== 1
  ) {
    // A canary guard can block the reclaim UPSERT for an abandoned provider
    // row. Only a genuinely live lease is safe to acknowledge as in-progress;
    // stale/unowned work must return 503 so Dodo retries after the canary.
    return { status: "deferred" };
  }
  return { status: "in_progress" };
}

export async function failDodoWebhookEventForLifecycleEmailRetry(
	env: AppEnv,
	eventId: string,
	input: {
		kind: DodoLifecycleEmailRetryKind;
		userId: string;
		idempotencyKey: string;
		error: string;
	},
) {
	// A retry run whose guarded grant no-ops finalizes the ledger as 'ignored'
	// (e.g. plan_change_guard_mismatch) while the email retry still runs from
	// state revalidation. Re-arming must succeed from BOTH terminal outcomes —
	// scoping to 'processed' only would silently drop the retry: this function
	// returns false, the caller swallows the provider failure, Dodo gets a 200
	// and never redelivers.
	const result = await run(
		env,
    `
      UPDATE dodo_webhook_event
      SET outcome = 'failed',
          processing_started_at = NULL,
          processed_at = NULL,
          metadata_json = ?
      WHERE event_id = ?
        AND outcome IN ('processed', 'ignored')
    `,
		jsonValue({ action: "lifecycle_email_retry", ...input }),
		eventId.trim(),
	);

	return Number(result.meta?.changes ?? 0) > 0;
}

/** @deprecated Use beginDodoWebhookEventProcessing for lease-aware claiming. */
export async function claimDodoWebhookEvent(
  env: AppEnv,
  input: {
    eventId: string;
    eventType: string;
    userId: string | null;
    payloadTimestamp: string | null;
  },
) {
  const claim = await beginDodoWebhookEventProcessing(env, input);
  return claim.status === "claimed";
}

function isMissingDodoProcessingLeaseColumnError(error: unknown) {
  return (
    error instanceof Error &&
    /dodo_webhook_event has no column named processing_started_at/i.test(error.message)
  );
}

export async function failDodoWebhookEventProcessing(
  env: AppEnv,
  eventId: string,
  metadata: JsonRecord = {},
) {
  await run(
    env,
    `
      UPDATE dodo_webhook_event
      SET outcome = 'failed',
          processing_started_at = NULL,
          processed_at = NULL,
          metadata_json = ?
      WHERE event_id = ?
        AND outcome = 'processing'
    `,
    jsonValue(metadata),
    eventId.trim(),
  );
}

/** @deprecated Ledger finalization is batched with business mutations. */
export async function markDodoWebhookEventFinished(
  env: AppEnv,
  eventId: string,
  input: {
    outcome: "processed" | "ignored" | "failed";
    metadata?: JsonRecord;
  },
) {
  if (input.outcome === "failed") {
    await failDodoWebhookEventProcessing(env, eventId, input.metadata ?? {});
    return;
  }

  await run(
    env,
    `
      UPDATE dodo_webhook_event
      SET outcome = ?,
          processed_at = ?,
          processing_started_at = NULL,
          metadata_json = ?
      WHERE event_id = ?
    `,
    input.outcome,
    nowIso(),
    jsonValue(input.metadata ?? {}),
    eventId,
  );
}

function isMissingDodoPayloadTimestampColumnError(error: unknown) {
  return (
    error instanceof Error &&
    /dodo_webhook_event has no column named payload_timestamp/i.test(error.message)
  );
}
