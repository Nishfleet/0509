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

type EmailReconciliationInput = {
  operatorUserId: string;
  attemptId: string;
  idempotencyKey: string;
  expectedUpdatedAt: string;
  outcome: ReconciliationOutcome;
  classification: BillingEmailEvidenceClassification;
  evidenceReference: string;
  observedAt: string;
};

type EmailReconciliationScope = {
  actionName: "ops.billing_email.reconcile" | "ops.digest_email.reconcile";
  evidencePath: "$.billingLifecycleProviderEvidence" | "$.digestProviderEvidence";
  idempotencyPrefix: "ops-billing-email-reconcile" | "ops-digest-email-reconcile";
  label: "Billing email" | "Digest email";
  attemptPredicate: string;
  updatesDigestDelivery: boolean;
};

const BILLING_RECONCILIATION_SCOPE: EmailReconciliationScope = {
  actionName: "ops.billing_email.reconcile",
  evidencePath: "$.billingLifecycleProviderEvidence",
  idempotencyPrefix: "ops-billing-email-reconcile",
  label: "Billing email",
  attemptPredicate: `
    AND delivery_attempt.digest_run_id IS NULL
    AND (
      delivery_attempt.idempotency_key LIKE 'billing-payment-issue:%'
      OR delivery_attempt.idempotency_key LIKE 'billing-cancellation:%'
      OR delivery_attempt.idempotency_key LIKE 'billing-refund:%'
    )
  `,
  updatesDigestDelivery: false,
};

const DIGEST_RECONCILIATION_SCOPE: EmailReconciliationScope = {
  actionName: "ops.digest_email.reconcile",
  evidencePath: "$.digestProviderEvidence",
  idempotencyPrefix: "ops-digest-email-reconcile",
  label: "Digest email",
  attemptPredicate: `
    AND delivery_attempt.digest_run_id IS NOT NULL
    AND delivery_attempt.delivery_target_id IS NOT NULL
    AND delivery_attempt.idempotency_key LIKE 'digest:%:customer:email:%'
  `,
  updatesDigestDelivery: true,
};

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

export function createDigestEmailReconciliationKey() {
  return `ops-digest-email-reconcile:${crypto.randomUUID()}`;
}

export async function reconcileBillingEmailAttemptWithAudit(
  env: AppEnv,
  input: EmailReconciliationInput,
) {
  return reconcileEmailAttemptWithAudit(env, input, BILLING_RECONCILIATION_SCOPE);
}

export async function reconcileDigestEmailAttemptWithAudit(
  env: AppEnv,
  input: EmailReconciliationInput,
) {
  return reconcileEmailAttemptWithAudit(env, input, DIGEST_RECONCILIATION_SCOPE);
}

async function reconcileEmailAttemptWithAudit(
  env: AppEnv,
  input: EmailReconciliationInput,
  scope: EmailReconciliationScope,
) {
  const normalized = normalizeInput(input, scope);
  if (!normalized) {
    return { ok: false as const, reason: "invalid_evidence" as const };
  }

  const db = ensureDb(env);
  if (typeof db.batch !== "function") {
    throw new Error(`Atomic D1 batch support is required for ${scope.label.toLowerCase()} reconciliation.`);
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
        SELECT ?, ?, NULL, ?, 'delivery_attempt',
          delivery_attempt.id, ?, 'succeeded', ?, NULL, NULL, ?, ?, ?
        FROM delivery_attempt
        WHERE delivery_attempt.id = ?
          AND delivery_attempt.updated_at = ?
          AND delivery_attempt.lane = 'customer'
          AND delivery_attempt.channel = 'email'
          AND (
            delivery_attempt.status = 'pending'
            OR (
              delivery_attempt.status = 'failed'
              AND delivery_attempt.provider_status_last_seen_at IS NOT NULL
            )
          )
          AND delivery_attempt.webhook_status = 'provider_unknown'
          ${scope.attemptPredicate}
      `,
    )
    .bind(
      auditId,
      normalized.operatorUserId,
      scope.actionName,
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
              ?,
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
          AND (
            status = 'pending'
            OR (
              status = 'failed'
              AND provider_status_last_seen_at IS NOT NULL
            )
          )
          AND webhook_status = 'provider_unknown'
          ${scope.attemptPredicate}
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
      scope.evidencePath,
      jsonValue(evidence),
      errorMessage,
      normalized.outcome === "sent" ? normalized.observedAt : null,
      normalized.outcome === "failed" ? normalized.observedAt : null,
      reconciledAt,
      normalized.attemptId,
      normalized.expectedUpdatedAt,
      auditId,
    );

  const statements: D1PreparedStatement[] = [insertAudit, updateAttempt];
  if (scope.updatesDigestDelivery) {
    statements.push(
      db
        .prepare(
          `
            INSERT INTO digest_delivery (
              id, digest_run_id, provider, status, recipient_email,
              external_message_id, error_message, delivered_at, created_at, updated_at
            )
            SELECT ?, delivery_attempt.digest_run_id, delivery_attempt.provider, ?,
              delivery_attempt.target_value, delivery_attempt.provider_message_id,
              ?, ?, ?, ?
            FROM delivery_attempt
            WHERE delivery_attempt.id = ?
              AND delivery_attempt.digest_run_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM agent_action_audit
                WHERE agent_action_audit.id = ?
                  AND agent_action_audit.status = 'succeeded'
              )
            ON CONFLICT(digest_run_id)
            DO UPDATE SET
              provider = CASE
                WHEN digest_delivery.status = 'sent' AND excluded.status != 'sent'
                  THEN digest_delivery.provider
                ELSE excluded.provider
              END,
              status = CASE
                WHEN digest_delivery.status = 'sent' THEN 'sent'
                ELSE excluded.status
              END,
              recipient_email = CASE
                WHEN digest_delivery.status = 'sent' AND excluded.status != 'sent'
                  THEN digest_delivery.recipient_email
                ELSE excluded.recipient_email
              END,
              external_message_id = CASE
                WHEN digest_delivery.status = 'sent' AND excluded.status != 'sent'
                  THEN digest_delivery.external_message_id
                ELSE excluded.external_message_id
              END,
              error_message = CASE
                WHEN digest_delivery.status = 'sent' AND excluded.status != 'sent'
                  THEN digest_delivery.error_message
                ELSE excluded.error_message
              END,
              delivered_at = CASE
                WHEN digest_delivery.status = 'sent' AND excluded.status != 'sent'
                  THEN digest_delivery.delivered_at
                ELSE excluded.delivered_at
              END,
              updated_at = excluded.updated_at
          `,
        )
        .bind(
          createId(),
          status,
          errorMessage,
          normalized.outcome === "sent" ? normalized.observedAt : null,
          reconciledAt,
          reconciledAt,
          normalized.attemptId,
          auditId,
        ),
    );
  }

  const batch = await db.batch(statements);
  const auditCreated = Number(batch[0]?.meta?.changes ?? 0) === 1;
  const attemptUpdated = Number(batch[1]?.meta?.changes ?? 0) === 1;
  const digestDeliveryUpdated = scope.updatesDigestDelivery
    ? Number(batch[2]?.meta?.changes ?? 0) === 1
    : attemptUpdated;
  if (auditCreated && attemptUpdated && digestDeliveryUpdated) {
    return { ok: true as const, replayed: false, ...result };
  }
  if (auditCreated !== attemptUpdated || auditCreated !== digestDeliveryUpdated) {
    throw new Error(`${scope.label} reconciliation audit/effect integrity check failed.`);
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

function normalizeInput(input: EmailReconciliationInput, scope: EmailReconciliationScope) {
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
    !new RegExp(`^${scope.idempotencyPrefix}:[0-9a-f-]{36}$`, "i").test(input.idempotencyKey) ||
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
