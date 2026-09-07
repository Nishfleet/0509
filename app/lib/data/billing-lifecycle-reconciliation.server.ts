import { ensureDb, queryAll } from "~/lib/data/d1.server";
import { createId, jsonValue, nowIso } from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";

const MAX_ATTEMPT_ID_LENGTH = 128;
const MAX_OPERATOR_ID_LENGTH = 128;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_EVIDENCE_REFERENCE_LENGTH = 512;
const MAX_PROVIDER_MESSAGE_ID_LENGTH = 255;

export const BILLING_LIFECYCLE_RECONCILIATION_ERROR =
  "Provider evidence confirmed the billing lifecycle email was not accepted.";

export type BillingLifecycleReconciliationOutcome = "sent" | "failed";
export type BillingLifecycleEvidenceClassification =
  | "controlled_inbox_receipt"
  | "provider_acceptance_log"
  | "provider_delivery_confirmation"
  | "provider_rejection_log";

export interface BillingLifecycleEmailReconciliationInput {
  operatorUserId: string;
  attemptId: string;
  expectedUpdatedAt: string;
  outcome: BillingLifecycleReconciliationOutcome;
  evidenceClassification: BillingLifecycleEvidenceClassification;
  evidenceReference: string;
  observedAt: string;
  providerMessageId?: string | null;
  reconciledAt?: string;
}

export interface BillingLifecycleEmailReconciliationResult {
  reconciled: boolean;
  auditId: string | null;
  idempotencyKey: string;
}

export interface BillingLifecycleReconciliationCandidate {
  attemptId: string;
  lifecycleKind: "payment_issue" | "cancellation_scheduled" | "access_ended" | "refund_revoked";
  status: "pending" | "sent";
  providerStatusLastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listBillingLifecycleReconciliationCandidates(
  env: AppEnv,
): Promise<BillingLifecycleReconciliationCandidate[]> {
  return queryAll<BillingLifecycleReconciliationCandidate>(
    env,
    `
      SELECT
        id AS attemptId,
        CASE template_name
          WHEN 'billing_payment_issue' THEN 'payment_issue'
          WHEN 'billing_cancellation_scheduled' THEN 'cancellation_scheduled'
          WHEN 'billing_access_ended' THEN 'access_ended'
          WHEN 'billing_refund_revoked' THEN 'refund_revoked'
        END AS lifecycleKind,
        status,
        provider_status_last_seen_at AS providerStatusLastSeenAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM delivery_attempt
      WHERE lane = 'customer'
        AND channel = 'email'
        AND provider = 'cloudflare_email'
        AND watchlist_id IS NULL
        AND digest_run_id IS NULL
        AND delivery_target_id IS NULL
        AND status IN ('pending', 'sent')
        AND webhook_status = 'provider_unknown'
        AND (
          (idempotency_key LIKE 'billing-payment-issue:%' AND template_name = 'billing_payment_issue')
          OR (
            idempotency_key LIKE 'billing-cancellation:%'
            AND template_name IN ('billing_cancellation_scheduled', 'billing_access_ended')
          )
          OR (
            idempotency_key LIKE 'billing-refund:%'
            AND template_name = 'billing_refund_revoked'
          )
        )
      ORDER BY
        CASE status WHEN 'pending' THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 20
    `,
  );
}

function boundedText(
  name: string,
  value: string | null | undefined,
  maxLength: number,
  options: { required?: boolean; safeIdentifier?: boolean } = {},
) {
  if (typeof value !== "string") {
    if (options.required) throw new TypeError(`${name} is required.`);
    return null;
  }

  const normalized = value.trim();
  if (options.required && normalized.length === 0) {
    throw new TypeError(`${name} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new RangeError(`${name} exceeds the maximum length of ${maxLength}.`);
  }
  if (/^[\u0000-\u001F\u007F]+/.test(normalized) || /[\u0000-\u001F\u007F<>]/.test(normalized)) {
    throw new TypeError(`${name} contains unsupported characters.`);
  }
  if (options.safeIdentifier && !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new TypeError(`${name} contains unsupported characters.`);
  }
  return normalized;
}

function validateInput(input: BillingLifecycleEmailReconciliationInput) {
  const operatorUserId = boundedText(
    "operatorUserId",
    input.operatorUserId,
    MAX_OPERATOR_ID_LENGTH,
    { required: true, safeIdentifier: true },
  )!;
  const attemptId = boundedText("attemptId", input.attemptId, MAX_ATTEMPT_ID_LENGTH, {
    required: true,
    safeIdentifier: true,
  })!;
  const expectedUpdatedAt = boundedText(
    "expectedUpdatedAt",
    input.expectedUpdatedAt,
    MAX_TIMESTAMP_LENGTH,
    { required: true },
  )!;
  const evidenceReference = boundedText(
    "evidenceReference",
    input.evidenceReference,
    MAX_EVIDENCE_REFERENCE_LENGTH,
    { required: true },
  )!;
  const evidenceClassification = boundedText(
    "evidenceClassification",
    input.evidenceClassification,
    64,
    { required: true, safeIdentifier: true },
  ) as BillingLifecycleEvidenceClassification;
  const providerMessageId = boundedText(
    "providerMessageId",
    input.providerMessageId,
    MAX_PROVIDER_MESSAGE_ID_LENGTH,
  );
  const observedAt = boundedText(
    "observedAt",
    input.observedAt,
    MAX_TIMESTAMP_LENGTH,
    { required: true },
  )!;
  const reconciledAt = boundedText(
    "reconciledAt",
    input.reconciledAt ?? nowIso(),
    MAX_TIMESTAMP_LENGTH,
    { required: true },
  )!;

  if (input.outcome !== "sent" && input.outcome !== "failed") {
    throw new TypeError("outcome must be sent or failed.");
  }
  const allowedClassification =
    input.outcome === "failed"
      ? evidenceClassification === "provider_rejection_log"
      : evidenceClassification === "controlled_inbox_receipt" ||
        evidenceClassification === "provider_acceptance_log" ||
        evidenceClassification === "provider_delivery_confirmation";
  if (!allowedClassification) {
    throw new TypeError("evidenceClassification does not prove the selected outcome.");
  }
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new TypeError("observedAt must be a valid timestamp.");
  }

  return {
    operatorUserId,
    attemptId,
    expectedUpdatedAt,
    evidenceClassification,
    evidenceReference,
    observedAt,
    providerMessageId,
    reconciledAt,
    outcome: input.outcome,
  };
}

/**
 * Reconciles one ambiguous billing lifecycle email from operator-supplied
 * provider evidence. The delivery transition and its audit are one D1 batch;
 * an audit failure therefore rolls the delivery transition back as well.
 */
export async function reconcileBillingLifecycleEmailAttempt(
  env: AppEnv,
  input: BillingLifecycleEmailReconciliationInput,
): Promise<BillingLifecycleEmailReconciliationResult> {
  const validated = validateInput(input);
  const db = ensureDb(env);
  const reconciliationIdempotencyKey = `billing-lifecycle-reconcile:${validated.attemptId}:${validated.expectedUpdatedAt}`;
  const auditId = createId();
  const nextStatus = validated.outcome === "sent" ? "sent" : "failed";
  const nextWebhookStatus =
    validated.outcome === "failed"
      ? "failed"
      : validated.evidenceClassification === "provider_acceptance_log"
        ? "provider_unknown"
        : "delivered";
  const nextErrorMessage = validated.outcome === "failed" ? BILLING_LIFECYCLE_RECONCILIATION_ERROR : null;
  const transition = db
    .prepare(`
      UPDATE delivery_attempt
      SET status = ?,
          webhook_status = ?,
          provider_message_id = COALESCE(?, provider_message_id),
          provider_status_last_seen_at = ?,
          error_message = ?,
          sent_at = CASE
            WHEN ? = 'sent' THEN COALESCE(sent_at, ?)
            ELSE sent_at
          END,
          failed_at = CASE
            WHEN ? = 'failed' THEN ?
            ELSE NULL
          END,
          updated_at = ?
      WHERE id = ?
        AND lane = 'customer'
        AND channel = 'email'
        AND provider = 'cloudflare_email'
        AND watchlist_id IS NULL
        AND digest_run_id IS NULL
        AND delivery_target_id IS NULL
        AND status IN ('pending', 'sent')
        AND webhook_status = 'provider_unknown'
        AND updated_at = ?
        AND (
          sent_at IS NULL
          OR julianday(?) >= julianday(sent_at)
        )
        AND julianday(?) >= julianday(created_at)
        AND julianday(?) <= julianday(?, '+5 minutes')
        AND (
          status = 'pending'
          OR ? != 'provider_acceptance_log'
        )
        AND (
          (idempotency_key LIKE 'billing-payment-issue:%' AND template_name = 'billing_payment_issue')
          OR (
            idempotency_key LIKE 'billing-cancellation:%'
            AND template_name IN ('billing_cancellation_scheduled', 'billing_access_ended')
          )
          OR (
            idempotency_key LIKE 'billing-refund:%'
            AND template_name = 'billing_refund_revoked'
          )
        )
    `)
    .bind(
      nextStatus,
      nextWebhookStatus,
      validated.providerMessageId,
      validated.observedAt,
      nextErrorMessage,
      validated.outcome,
      validated.observedAt,
      validated.outcome,
      validated.observedAt,
      validated.reconciledAt,
      validated.attemptId,
      validated.expectedUpdatedAt,
      validated.observedAt,
      validated.observedAt,
      validated.observedAt,
      validated.reconciledAt,
      validated.evidenceClassification,
    );

  const auditMetadata = jsonValue({
    outcome: validated.outcome,
    evidenceClassification: validated.evidenceClassification,
    evidenceReference: validated.evidenceReference,
    observedAt: validated.observedAt,
    providerMessageId: validated.providerMessageId,
  });
  const auditResult = jsonValue({
    deliveryAttemptStatus: nextStatus,
    webhookStatus: nextWebhookStatus,
  });
  const audit = db
    .prepare(`
      INSERT INTO agent_action_audit (
        id,
        user_id,
        api_key_id,
        action_name,
        resource_type,
        resource_id,
        idempotency_key,
        status,
        result_json,
        error_code,
        error_message,
        metadata_json,
        created_at,
        updated_at
      )
      SELECT ?, ?, NULL, 'billing.lifecycle_email.reconcile', 'delivery_attempt', ?, ?,
             'succeeded', ?, ?, ?, ?, ?, ?
      WHERE changes() > 0
    `)
    .bind(
      auditId,
      validated.operatorUserId,
      validated.attemptId,
      reconciliationIdempotencyKey,
      auditResult,
      validated.outcome === "failed" ? "provider_evidence_failed" : null,
      nextErrorMessage,
      auditMetadata,
      validated.reconciledAt,
      validated.reconciledAt,
    );

  const results = await db.batch([transition, audit]);
  const reconciled = Number(results[0]?.meta?.changes ?? 0) > 0;
  const auditInserted = Number(results[1]?.meta?.changes ?? 0) > 0;

  return {
    reconciled,
    auditId: reconciled && auditInserted ? auditId : null,
    idempotencyKey: reconciliationIdempotencyKey,
  };
}
