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

export type DodoWebhookProcessingClaim =
  | { status: "claimed" }
  | { status: "duplicate"; outcome: "processed" | "ignored" }
  | { status: "in_progress" };

function dodoWebhookProcessingLeaseDays() {
  return DODO_WEBHOOK_PROCESSING_LEASE_MS / (24 * 60 * 60 * 1000);
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
  },
): Promise<DodoWebhookProcessingClaim> {
  const eventId = input.eventId.trim();
  if (!eventId) {
    throw new Error("Dodo webhook event id is required.");
  }

  const db = ensureDb(env);
  const receivedAt = nowIso();
  const leaseDays = dodoWebhookProcessingLeaseDays();
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
      VALUES (?, ?, ?, ?, ?, 'processing', ?, '{}')
      ON CONFLICT(event_id)
      DO UPDATE SET
        event_type = excluded.event_type,
        user_id = excluded.user_id,
        received_at = excluded.received_at,
        payload_timestamp = excluded.payload_timestamp,
        outcome = 'processing',
        processing_started_at = excluded.processing_started_at,
        processed_at = NULL,
        metadata_json = '{}'
      WHERE ${reclaimWhere}
    `).bind(
      eventId,
      input.eventType,
      input.userId,
      receivedAt,
      input.payloadTimestamp,
      receivedAt,
      receivedAt,
      leaseDays,
    ).run();
  } catch (error) {
    if (!isMissingDodoPayloadTimestampColumnError(error) && !isMissingDodoProcessingLeaseColumnError(error)) {
      throw error;
    }

    result = await db.prepare(`
        INSERT INTO dodo_webhook_event (
          event_id,
          event_type,
          user_id,
          received_at,
          outcome,
          metadata_json
        )
        VALUES (?, ?, ?, ?, 'received', '{}')
        ON CONFLICT(event_id)
        DO UPDATE SET
          event_type = excluded.event_type,
          user_id = excluded.user_id,
          received_at = excluded.received_at,
          processed_at = NULL,
          outcome = 'received',
          metadata_json = '{}'
        WHERE dodo_webhook_event.outcome = 'failed'
      `).bind(
        eventId,
        input.eventType,
        input.userId,
        receivedAt,
      ).run();
  }

  if (Number(result.meta?.changes ?? 0) > 0) {
    return { status: "claimed" };
  }

  const row = await one<{ outcome: string }>(
    env,
    "SELECT outcome FROM dodo_webhook_event WHERE event_id = ?",
    eventId,
  );
  if (row?.outcome === "processed" || row?.outcome === "ignored") {
    return { status: "duplicate", outcome: row.outcome };
  }
  return { status: "in_progress" };
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
