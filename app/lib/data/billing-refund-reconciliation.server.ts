import { ensureDb, queryAll } from "~/lib/data/d1.server";
import { validIsoTimestamp } from "~/lib/data/billing-helpers.server";
import { createId, jsonValue, nowIso } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";

const MAX_ID_LENGTH = 128;
const MAX_EVIDENCE_REFERENCE_LENGTH = 512;
const MAX_CREDIT_QUANTITY = 1_000_000;

export type PartialRefundReconciliationDecision = "retain" | "revoke";

export interface PendingPartialRefundReconciliation {
  eventId: string;
  paymentId: string;
  refundId: string;
  refundAmount: number | null;
  refundCurrency: string | null;
  refundReason: string | null;
  processedAt: string;
  availableCredits: number;
}

export function partialRefundReconciliationKey(eventId: string) {
  return `billing-partial-refund-reconcile:${eventId}:v1`;
}

export function partialRefundLedgerKey(eventId: string, paymentId: string) {
  return `operator-refund:${eventId}:${paymentId}:v1`;
}

export async function listPendingPartialRefundReconciliations(
  env: AppEnv,
): Promise<PendingPartialRefundReconciliation[]> {
  return queryAll<PendingPartialRefundReconciliation>(
    env,
    `
      SELECT event.event_id AS eventId,
             json_extract(event.metadata_json, '$.paymentId') AS paymentId,
             json_extract(event.metadata_json, '$.refundId') AS refundId,
             json_extract(event.metadata_json, '$.refundAmount') AS refundAmount,
             json_extract(event.metadata_json, '$.refundCurrency') AS refundCurrency,
             json_extract(event.metadata_json, '$.refundReason') AS refundReason,
             event.processed_at AS processedAt,
             MAX(
               0,
               COALESCE(grant.quantity_granted, 0) + COALESCE((
                 SELECT SUM(entry.quantity_delta)
                 FROM evidence_top_up_ledger_entry AS entry
                 WHERE entry.grant_id = grant.id
               ), 0)
             ) AS availableCredits
      FROM dodo_webhook_event AS event
      LEFT JOIN evidence_top_up_grant AS grant
        ON grant.provider_payment_id = json_extract(event.metadata_json, '$.paymentId')
      WHERE event.event_type = 'refund.succeeded'
        AND event.outcome = 'processed'
        AND json_extract(event.metadata_json, '$.action') = 'refund'
        AND json_extract(event.metadata_json, '$.refundType') = 'partial'
        AND json_extract(event.metadata_json, '$.creditMutationPolicy') = 'audit_only_v2'
        AND json_extract(event.metadata_json, '$.refundReconciliationStatus') = 'pending'
        AND COALESCE(json_extract(event.metadata_json, '$.paymentId'), '') != ''
        AND COALESCE(json_extract(event.metadata_json, '$.refundId'), '') != ''
        AND event.processed_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM agent_action_audit AS audit
          WHERE audit.action_name = 'billing.partial_refund.reconcile'
            AND audit.resource_type = 'dodo_webhook_event'
            AND audit.resource_id = event.event_id
            AND audit.status = 'succeeded'
        )
      ORDER BY event.processed_at ASC
      LIMIT 50
    `,
  );
}

export async function reconcilePartialRefundWithAudit(
  env: AppEnv,
  input: {
    operatorUserId: string;
    eventId: string;
    expectedProcessedAt: string;
    decision: PartialRefundReconciliationDecision;
    creditQuantityToRevoke: number;
    evidenceReference: string;
    observedAt: string;
  },
) {
  const operatorUserId = cleanId(input.operatorUserId, "operatorUserId");
  const eventId = cleanId(input.eventId, "eventId");
  const expectedProcessedAt = typeof input.expectedProcessedAt === "string"
    ? validIsoTimestamp(input.expectedProcessedAt)
    : null;
  const observedAt = typeof input.observedAt === "string"
    ? validIsoTimestamp(input.observedAt)
    : null;
  const evidenceReference = cleanText(
    input.evidenceReference,
    "evidenceReference",
    MAX_EVIDENCE_REFERENCE_LENGTH,
  );
  if (!expectedProcessedAt || !observedAt) throw new TypeError("invalid_partial_refund_timestamp");
  if (input.decision !== "retain" && input.decision !== "revoke") {
    throw new TypeError("invalid_partial_refund_decision");
  }
  const requestedQuantity = Number(input.creditQuantityToRevoke);
  if (
    !Number.isSafeInteger(requestedQuantity) ||
    requestedQuantity < 0 ||
    requestedQuantity > MAX_CREDIT_QUANTITY ||
    (input.decision === "retain" && requestedQuantity !== 0) ||
    (input.decision === "revoke" && requestedQuantity === 0)
  ) {
    throw new RangeError("invalid_partial_refund_credit_quantity");
  }

  const db = ensureDb(env);
  if (typeof db.batch !== "function") {
    throw new Error("Atomic D1 batch support is required for partial-refund reconciliation.");
  }
  const row = await db
    .prepare(
      `
        SELECT event.event_id AS eventId,
               event.processed_at AS processedAt,
               json_extract(event.metadata_json, '$.paymentId') AS paymentId,
               json_extract(event.metadata_json, '$.refundId') AS refundId,
               json_extract(event.metadata_json, '$.refundReconciliationStatus') AS reconciliationStatus,
               grant.id AS grantId,
               grant.workspace_user_id AS workspaceUserId,
               MAX(
                 0,
                 COALESCE(grant.quantity_granted, 0) + COALESCE((
                   SELECT SUM(entry.quantity_delta)
                   FROM evidence_top_up_ledger_entry AS entry
                   WHERE entry.grant_id = grant.id
                 ), 0)
               ) AS availableCredits
        FROM dodo_webhook_event AS event
        LEFT JOIN evidence_top_up_grant AS grant
          ON grant.provider_payment_id = json_extract(event.metadata_json, '$.paymentId')
        WHERE event.event_id = ?
          AND event.event_type = 'refund.succeeded'
          AND event.outcome = 'processed'
          AND json_extract(event.metadata_json, '$.action') = 'refund'
          AND json_extract(event.metadata_json, '$.refundType') = 'partial'
          AND json_extract(event.metadata_json, '$.creditMutationPolicy') = 'audit_only_v2'
        LIMIT 1
      `,
    )
    .bind(eventId)
    .first<{
      eventId: string;
      processedAt: string;
      paymentId: string | null;
      refundId: string | null;
      reconciliationStatus: string;
      grantId: string | null;
      workspaceUserId: string | null;
      availableCredits: number;
    }>();

  if (!row || row.processedAt !== expectedProcessedAt) {
    return { reconciled: false as const, reason: "stale" as const };
  }
  if (!row.paymentId || !row.refundId) {
    return { reconciled: false as const, reason: "unresolvable" as const };
  }

  const idempotencyKey = partialRefundReconciliationKey(eventId);
  const existing = await db
    .prepare(
      `
        SELECT status, metadata_json AS metadataJson, result_json AS resultJson
        FROM agent_action_audit
        WHERE action_name = 'billing.partial_refund.reconcile'
          AND resource_type = 'dodo_webhook_event'
          AND resource_id = ?
          AND idempotency_key = ?
        LIMIT 1
      `,
    )
    .bind(eventId, idempotencyKey)
    .first<{ status: string; metadataJson: string; resultJson: string }>();
  if (existing) {
    if (existing.status !== "succeeded" || row.reconciliationStatus !== "resolved") {
      return { reconciled: false as const, reason: "idempotency_conflict" as const };
    }
    const metadata = parseJsonObject(existing.metadataJson);
    const result = parseJsonObject(existing.resultJson);
    const persistedAppliedQuantity = Number(result.appliedQuantity);
    const validPersistedQuantity =
      Number.isSafeInteger(persistedAppliedQuantity) &&
      persistedAppliedQuantity >= 0 &&
      persistedAppliedQuantity <= requestedQuantity &&
      (input.decision === "retain"
        ? persistedAppliedQuantity === 0
        : persistedAppliedQuantity > 0) &&
      Number(metadata.appliedQuantity) === persistedAppliedQuantity;
    const exactReplay =
      metadata.decision === input.decision &&
      metadata.paymentId === row.paymentId &&
      metadata.refundId === row.refundId &&
      metadata.evidenceReference === evidenceReference &&
      metadata.observedAt === observedAt &&
      metadata.requestedQuantity === requestedQuantity &&
      validPersistedQuantity;
    return exactReplay
      ? {
          reconciled: true as const,
          replayed: true as const,
          appliedQuantity: persistedAppliedQuantity,
          decision: input.decision,
        }
      : { reconciled: false as const, reason: "idempotency_conflict" as const };
  }
  if (row.reconciliationStatus !== "pending") {
    return { reconciled: false as const, reason: "stale" as const };
  }

  const availableCredits = Math.max(0, Number(row.availableCredits ?? 0));
  const appliedQuantity = input.decision === "revoke"
    ? Math.min(requestedQuantity, availableCredits)
    : 0;
  if (input.decision === "revoke" && (!row.grantId || !row.workspaceUserId || appliedQuantity <= 0)) {
    return { reconciled: false as const, reason: "grant_unavailable" as const };
  }

  const ledgerKey = partialRefundLedgerKey(eventId, row.paymentId);
  const reconciledAt = nowIso();
  const auditMetadata = {
    decision: input.decision,
    paymentId: row.paymentId,
    refundId: row.refundId,
    evidenceReference,
    observedAt,
    requestedQuantity,
    appliedQuantity,
  };
  const statements: D1PreparedStatement[] = [];
  if (input.decision === "revoke") {
    statements.push(
      db
        .prepare(
          `
            INSERT INTO evidence_top_up_ledger_entry (
              id, grant_id, workspace_user_id, quantity_delta, entry_type,
              reservation_id, idempotency_key, metadata_json, created_at
            )
            SELECT ?, grant.id, grant.workspace_user_id, ?, 'refund', NULL, ?, ?, ?
            FROM evidence_top_up_grant AS grant
            WHERE grant.id = ?
              AND MAX(
                    0,
                    grant.quantity_granted + COALESCE((
                      SELECT SUM(entry.quantity_delta)
                      FROM evidence_top_up_ledger_entry AS entry
                      WHERE entry.grant_id = grant.id
                    ), 0)
                  ) >= ?
              AND EXISTS (
              SELECT 1
              FROM dodo_webhook_event
              WHERE event_id = ?
                AND processed_at = ?
                AND json_extract(metadata_json, '$.refundReconciliationStatus') = 'pending'
            )
            ON CONFLICT(idempotency_key) DO NOTHING
          `,
        )
        .bind(
          createId(),
          -appliedQuantity,
          ledgerKey,
          jsonValue({
            reason: "partial_provider_refund",
            providerEventId: eventId,
            evidenceReference,
            requestedQuantity,
            appliedQuantity,
          }),
          reconciledAt,
          row.grantId,
          appliedQuantity,
          eventId,
          expectedProcessedAt,
        ),
      db
        .prepare(
          `
            UPDATE evidence_top_up_grant
            SET quantity_remaining = MAX(
                  0,
                  quantity_granted + COALESCE((
                    SELECT SUM(quantity_delta)
                    FROM evidence_top_up_ledger_entry
                    WHERE grant_id = evidence_top_up_grant.id
                  ), 0)
                ),
                status = CASE
                  WHEN quantity_granted + COALESCE((
                    SELECT SUM(quantity_delta)
                    FROM evidence_top_up_ledger_entry
                    WHERE grant_id = evidence_top_up_grant.id
                  ), 0) <= 0 THEN 'depleted'
                  ELSE 'active'
                END
            WHERE id = ?
              AND EXISTS (
                SELECT 1 FROM evidence_top_up_ledger_entry WHERE idempotency_key = ?
              )
          `,
        )
        .bind(row.grantId, ledgerKey),
    );
  }

  const ledgerRequiredSql = input.decision === "revoke"
    ? `AND EXISTS (
         SELECT 1
         FROM evidence_top_up_ledger_entry AS resolution_ledger
         WHERE resolution_ledger.idempotency_key = ?
           AND resolution_ledger.grant_id = ?
           AND resolution_ledger.workspace_user_id = ?
           AND resolution_ledger.quantity_delta = ?
           AND resolution_ledger.entry_type = 'refund'
           AND json_extract(resolution_ledger.metadata_json, '$.providerEventId') = ?
           AND json_extract(resolution_ledger.metadata_json, '$.reason') = 'partial_provider_refund'
           AND json_extract(resolution_ledger.metadata_json, '$.evidenceReference') = ?
           AND json_extract(resolution_ledger.metadata_json, '$.requestedQuantity') = ?
           AND json_extract(resolution_ledger.metadata_json, '$.appliedQuantity') = ?
       )`
    : "";
  statements.push(
    db
      .prepare(
        `
          UPDATE dodo_webhook_event
          SET metadata_json = json_set(
                metadata_json,
                '$.refundReconciliationStatus', 'resolved',
                '$.refundReconciliationDecision', ?,
                '$.refundReconciliationObservedAt', ?,
                '$.refundReconciliationEvidenceReference', ?,
                '$.refundReconciliationRequestedQuantity', ?,
                '$.refundReconciliationAppliedQuantity', ?
              )
          WHERE event_id = ?
            AND processed_at = ?
            AND json_extract(metadata_json, '$.refundReconciliationStatus') = 'pending'
            ${ledgerRequiredSql}
            AND NOT EXISTS (
              SELECT 1 FROM agent_action_audit
              WHERE action_name = 'billing.partial_refund.reconcile'
                AND resource_type = 'dodo_webhook_event'
                AND resource_id = ?
                AND status = 'succeeded'
            )
        `,
      )
      .bind(
        input.decision,
        observedAt,
        evidenceReference,
        requestedQuantity,
        appliedQuantity,
        eventId,
        expectedProcessedAt,
        ...(input.decision === "revoke"
          ? [
              ledgerKey,
              row.grantId,
              row.workspaceUserId,
              -appliedQuantity,
              eventId,
              evidenceReference,
              requestedQuantity,
              appliedQuantity,
            ]
          : []),
        eventId,
      ),
    db
      .prepare(
        `
          INSERT INTO agent_action_audit (
            id, user_id, api_key_id, action_name, resource_type, resource_id,
            idempotency_key, status, result_json, error_code, error_message,
            metadata_json, created_at, updated_at
          )
          SELECT ?, ?, NULL, 'billing.partial_refund.reconcile',
                 'dodo_webhook_event', ?, ?, 'succeeded', ?, NULL, NULL, ?, ?, ?
          WHERE changes() > 0
        `,
      )
      .bind(
        createId(),
        operatorUserId,
        eventId,
        idempotencyKey,
        jsonValue({ decision: input.decision, appliedQuantity }),
        jsonValue(auditMetadata),
        reconciledAt,
        reconciledAt,
      ),
  );

  const results = await db.batch(statements);
  const transitionIndex = input.decision === "revoke" ? 2 : 0;
  const auditIndex = transitionIndex + 1;
  const reconciled = Number(results[transitionIndex]?.meta?.changes ?? 0) === 1;
  const audited = Number(results[auditIndex]?.meta?.changes ?? 0) === 1;
  if (!reconciled || !audited) {
    return { reconciled: false as const, reason: "stale" as const };
  }
  return {
    reconciled: true as const,
    replayed: false as const,
    appliedQuantity,
    decision: input.decision,
  };
}

function cleanId(value: unknown, field: string) {
  return cleanText(value, field, MAX_ID_LENGTH, true);
}

function cleanText(value: unknown, field: string, maxLength: number, safeIdentifier = false) {
  if (typeof value !== "string") throw new TypeError(`invalid_${field}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new TypeError(`invalid_${field}`);
  if (/[\u0000-\u001F\u007F<>]/u.test(normalized)) throw new TypeError(`invalid_${field}`);
  if (safeIdentifier && !/^[A-Za-z0-9._:-]+$/u.test(normalized)) {
    throw new TypeError(`invalid_${field}`);
  }
  return normalized;
}

function parseJsonObject(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
