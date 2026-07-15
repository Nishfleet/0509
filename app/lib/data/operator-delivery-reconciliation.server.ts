import { ensureDb, queryOne } from "~/lib/data/d1.server";
import { createId, jsonValue, nowIso, parseJson } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";

export const BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS = [
  "cloudflare_email_log",
  "controlled_inbox_receipt",
  "provider_rejection_log",
] as const;

export type BillingEmailEvidenceClassification =
  (typeof BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS)[number];

type ReconciliationOutcome = "sent" | "failed";

interface AuditRow {
  id: string;
  status: "started" | "succeeded" | "failed";
  result_json: string | null;
}

interface AttemptRow {
  id: string;
}

export function createBillingEmailReconciliationKey() {
  return `ops-billing-email-reconcile:${crypto.randomUUID()}`;
}

export async function reconcileBillingEmailAttemptWithAudit(
  env: AppEnv,
  input: {
    operatorUserId: string;
    attemptId: string;
    idempotencyKey: string;
    expectedUpdatedAt: string;
    outcome: ReconciliationOutcome;
    classification: BillingEmailEvidenceClassification;
    evidenceReference: string;
    observedAt: string;
  },
) {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return { ok: false as const, reason: "invalid_evidence" as const };
  }

  const db = ensureDb(env);
  if (typeof db.batch !== "function") {
    throw new Error("Atomic D1 batch support is required for billing email reconciliation.");
  }

  const auditId = createId();
  const reconciledAt = nowIso();
  const result = {
    attemptId: normalized.attemptId,
    outcome: normalized.outcome,
    classification: normalized.classification,
    observedAt: normalized.observedAt,
    reconciledAt,
  };
  const evidence = {
    reference: normalized.evidenceReference,
    classification: normalized.classification,
    observedAt: normalized.observedAt,
    outcome: normalized.outcome,
  };
  const auditMetadata = {
    evidenceReference: normalized.evidenceReference,
    evidenceClassification: normalized.classification,
    providerObservedAt: normalized.observedAt,
    reconciliationMode: "provider_evidence_only",
  };
  const status = normalized.outcome === "sent" ? "sent" : "failed";
  const webhookStatus = normalized.outcome === "sent" ? "delivered" : "failed";
  const errorMessage =
    normalized.outcome === "failed"
      ? "Provider reconciliation confirmed this email was not accepted."
      : null;

  const insertAudit = db
    .prepare(
      `
        INSERT OR IGNORE INTO agent_action_audit (
          id, user_id, api_key_id, action_name, resource_type, resource_id,
          idempotency_key, status, result_json, error_code, error_message,
          metadata_json, created_at, updated_at
        )
        SELECT ?, ?, NULL, 'ops.billing_email.reconcile', 'delivery_attempt',
          delivery_attempt.id, ?, 'succeeded', ?, NULL, NULL, ?, ?, ?
        FROM delivery_attempt
        WHERE delivery_attempt.id = ?
          AND delivery_attempt.updated_at = ?
          AND delivery_attempt.lane = 'customer'
          AND delivery_attempt.channel = 'email'
          AND delivery_attempt.status = 'pending'
          AND delivery_attempt.webhook_status = 'provider_unknown'
          AND (
            delivery_attempt.idempotency_key LIKE 'billing-payment-issue:%'
            OR delivery_attempt.idempotency_key LIKE 'billing-cancellation:%'
            OR delivery_attempt.idempotency_key LIKE 'billing-refund:%'
          )
      `,
    )
    .bind(
      auditId,
      normalized.operatorUserId,
      normalized.idempotencyKey,
      jsonValue(result),
      jsonValue(auditMetadata),
      reconciledAt,
      reconciledAt,
      normalized.attemptId,
      normalized.expectedUpdatedAt,
    );
  const updateAttempt = db
    .prepare(
      `
        UPDATE delivery_attempt
        SET status = ?,
            webhook_status = ?,
            provider_status_last_seen_at = ?,
            payload_snapshot_json = json_set(
              CASE
                WHEN json_valid(payload_snapshot_json) THEN payload_snapshot_json
                ELSE '{}'
              END,
              '$.billingLifecycleProviderEvidence',
              json(?)
            ),
            error_message = ?,
            sent_at = ?,
            failed_at = ?,
            updated_at = ?
        WHERE id = ?
          AND updated_at = ?
          AND lane = 'customer'
          AND channel = 'email'
          AND status = 'pending'
          AND webhook_status = 'provider_unknown'
          AND EXISTS (
            SELECT 1
            FROM agent_action_audit
            WHERE agent_action_audit.id = ?
              AND agent_action_audit.status = 'succeeded'
          )
      `,
    )
    .bind(
      status,
      webhookStatus,
      normalized.observedAt,
      jsonValue(evidence),
      errorMessage,
      normalized.outcome === "sent" ? normalized.observedAt : null,
      normalized.outcome === "failed" ? normalized.observedAt : null,
      reconciledAt,
      normalized.attemptId,
      normalized.expectedUpdatedAt,
      auditId,
    );

  const batch = await db.batch([insertAudit, updateAttempt]);
  const auditCreated = Number(batch[0]?.meta?.changes ?? 0) === 1;
  const attemptUpdated = Number(batch[1]?.meta?.changes ?? 0) === 1;
  if (auditCreated && attemptUpdated) {
    return { ok: true as const, replayed: false, ...result };
  }
  if (auditCreated !== attemptUpdated) {
    throw new Error("Billing email reconciliation audit/effect integrity check failed.");
  }

  const existingAudit = await queryOne<AuditRow>(
    env,
    `
      SELECT id, status, result_json
      FROM agent_action_audit
      WHERE user_id = ? AND idempotency_key = ?
      LIMIT 1
    `,
    normalized.operatorUserId,
    normalized.idempotencyKey,
  );
  const prior = parseJson<Record<string, unknown> | null>(existingAudit?.result_json, null);
  if (
    existingAudit?.status === "succeeded" &&
    prior?.attemptId === normalized.attemptId &&
    prior?.outcome === normalized.outcome &&
    prior?.classification === normalized.classification &&
    prior?.observedAt === normalized.observedAt
  ) {
    return {
      ok: true as const,
      replayed: true,
      attemptId: normalized.attemptId,
      outcome: normalized.outcome,
      classification: normalized.classification,
      observedAt: normalized.observedAt,
      reconciledAt:
        typeof prior.reconciledAt === "string" ? prior.reconciledAt : reconciledAt,
    };
  }
  if (existingAudit) {
    return { ok: false as const, reason: "idempotency_conflict" as const };
  }
  const attempt = await queryOne<AttemptRow>(
    env,
    "SELECT id FROM delivery_attempt WHERE id = ? LIMIT 1",
    normalized.attemptId,
  );
  return attempt
    ? { ok: false as const, reason: "stale" as const }
    : { ok: false as const, reason: "not_found" as const };
}

function normalizeInput(input: {
  operatorUserId: string;
  attemptId: string;
  idempotencyKey: string;
  expectedUpdatedAt: string;
  outcome: ReconciliationOutcome;
  classification: BillingEmailEvidenceClassification;
  evidenceReference: string;
  observedAt: string;
}) {
  const operatorUserId = input.operatorUserId.trim();
  const attemptId = input.attemptId.trim();
  const expectedUpdatedAt = normalizeTimestamp(input.expectedUpdatedAt);
  const observedAt = normalizeTimestamp(input.observedAt);
  const evidenceReference = input.evidenceReference.trim();
  const classification = BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS.includes(input.classification)
    ? input.classification
    : null;
  const allowedForOutcome =
    input.outcome === "sent"
      ? classification === "cloudflare_email_log" || classification === "controlled_inbox_receipt"
      : classification === "cloudflare_email_log" || classification === "provider_rejection_log";
  const observedTime = observedAt ? Date.parse(observedAt) : Number.NaN;
  if (
    !operatorUserId ||
    !attemptId ||
    !expectedUpdatedAt ||
    !observedAt ||
    observedTime > Date.now() + 5 * 60 * 1000 ||
    !allowedForOutcome ||
    !/^ops-billing-email-reconcile:[0-9a-f-]{36}$/i.test(input.idempotencyKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{5,159}$/.test(evidenceReference)
  ) {
    return null;
  }
  return {
    operatorUserId,
    attemptId,
    idempotencyKey: input.idempotencyKey,
    expectedUpdatedAt,
    outcome: input.outcome,
    classification,
    evidenceReference,
    observedAt,
  };
}

function normalizeTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
