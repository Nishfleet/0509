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

export const INSTANT_WHATSAPP_EVIDENCE_CLASSIFICATIONS = [
  "meta_whatsapp_message_log",
  "controlled_recipient_receipt",
  "provider_rejection_log",
] as const;

export const INSTANT_SLACK_EVIDENCE_CLASSIFICATIONS = [
  "slack_webhook_response",
  "controlled_channel_observation",
  "provider_rejection_log",
] as const;

export type InstantDeliveryChannel = "email" | "whatsapp" | "slack";
export type InstantDeliveryEvidenceClassification =
  | BillingEmailEvidenceClassification
  | (typeof INSTANT_WHATSAPP_EVIDENCE_CLASSIFICATIONS)[number]
  | (typeof INSTANT_SLACK_EVIDENCE_CLASSIFICATIONS)[number];

type ReconciliationOutcome = "sent" | "failed";

type DeliveryReconciliationInput = {
  operatorUserId: string;
  attemptId: string;
  idempotencyKey: string;
  expectedUpdatedAt: string;
  outcome: ReconciliationOutcome;
  classification: InstantDeliveryEvidenceClassification;
  evidenceReference: string;
  observedAt: string;
};

type DeliveryReconciliationScope = {
  actionName:
    | "ops.billing_email.reconcile"
    | "ops.digest_email.reconcile"
    | "ops.instant_email.reconcile"
    | "ops.instant_whatsapp.reconcile"
    | "ops.instant_slack.reconcile"
    | "ops.support_alert.reconcile";
  evidencePath:
    | "$.billingLifecycleProviderEvidence"
    | "$.digestProviderEvidence"
    | "$.instantAlertProviderEvidence"
    | "$.supportAlertProviderEvidence";
  idempotencyPrefix:
    | "ops-billing-email-reconcile"
    | "ops-digest-email-reconcile"
    | "ops-instant-email-reconcile"
    | "ops-instant-whatsapp-reconcile"
    | "ops-instant-slack-reconcile"
    | "ops-support-alert-reconcile";
  label:
    | "Billing email"
    | "Digest email"
    | "Instant alert email"
    | "Instant alert WhatsApp"
    | "Instant alert Slack"
    | "Support alert";
  lane: "customer" | "internal";
  classifications: readonly InstantDeliveryEvidenceClassification[];
  sentClassifications: readonly InstantDeliveryEvidenceClassification[];
  failedClassifications: readonly InstantDeliveryEvidenceClassification[];
  attemptPredicate: string;
  allowsUnclassifiedFailure: boolean;
  allowsAcceptedProviderUnknown: boolean;
  requiresSettledProviderWindow: boolean;
  updatesDigestDelivery: boolean;
};

const BILLING_RECONCILIATION_SCOPE: DeliveryReconciliationScope = {
  actionName: "ops.billing_email.reconcile",
  evidencePath: "$.billingLifecycleProviderEvidence",
  idempotencyPrefix: "ops-billing-email-reconcile",
  label: "Billing email",
  lane: "customer",
  classifications: BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS,
  sentClassifications: ["cloudflare_email_log", "controlled_inbox_receipt"],
  failedClassifications: ["cloudflare_email_log", "provider_rejection_log"],
  attemptPredicate: `
    AND delivery_attempt.channel = 'email'
    AND delivery_attempt.digest_run_id IS NULL
    AND (
      delivery_attempt.idempotency_key LIKE 'billing-payment-issue:%'
      OR delivery_attempt.idempotency_key LIKE 'billing-cancellation:%'
      OR delivery_attempt.idempotency_key LIKE 'billing-refund:%'
    )
  `,
  allowsUnclassifiedFailure: false,
  allowsAcceptedProviderUnknown: true,
  requiresSettledProviderWindow: false,
  updatesDigestDelivery: false,
};

const DIGEST_RECONCILIATION_SCOPE: DeliveryReconciliationScope = {
  actionName: "ops.digest_email.reconcile",
  evidencePath: "$.digestProviderEvidence",
  idempotencyPrefix: "ops-digest-email-reconcile",
  label: "Digest email",
  lane: "customer",
  classifications: BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS,
  sentClassifications: ["cloudflare_email_log", "controlled_inbox_receipt"],
  failedClassifications: ["cloudflare_email_log", "provider_rejection_log"],
  attemptPredicate: `
    AND delivery_attempt.channel = 'email'
    AND delivery_attempt.digest_run_id IS NOT NULL
    AND delivery_attempt.delivery_target_id IS NOT NULL
    AND delivery_attempt.idempotency_key LIKE 'digest:%:customer:email:%'
  `,
  allowsUnclassifiedFailure: false,
  allowsAcceptedProviderUnknown: true,
  requiresSettledProviderWindow: false,
  updatesDigestDelivery: true,
};

const INSTANT_RECONCILIATION_SCOPE: DeliveryReconciliationScope = {
  actionName: "ops.instant_email.reconcile",
  evidencePath: "$.instantAlertProviderEvidence",
  idempotencyPrefix: "ops-instant-email-reconcile",
  label: "Instant alert email",
  lane: "customer",
  classifications: BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS,
  sentClassifications: ["cloudflare_email_log", "controlled_inbox_receipt"],
  failedClassifications: ["cloudflare_email_log", "provider_rejection_log"],
  attemptPredicate: `
    AND delivery_attempt.channel = 'email'
    AND delivery_attempt.watchlist_id IS NOT NULL
    AND delivery_attempt.digest_run_id IS NULL
    AND delivery_attempt.delivery_target_id IS NOT NULL
    AND delivery_attempt.idempotency_key LIKE 'instant:%:customer:email:%'
  `,
  allowsUnclassifiedFailure: false,
  allowsAcceptedProviderUnknown: true,
  requiresSettledProviderWindow: false,
  updatesDigestDelivery: false,
};

const INSTANT_WHATSAPP_RECONCILIATION_SCOPE: DeliveryReconciliationScope = {
  actionName: "ops.instant_whatsapp.reconcile",
  evidencePath: "$.instantAlertProviderEvidence",
  idempotencyPrefix: "ops-instant-whatsapp-reconcile",
  label: "Instant alert WhatsApp",
  lane: "customer",
  classifications: INSTANT_WHATSAPP_EVIDENCE_CLASSIFICATIONS,
  sentClassifications: ["meta_whatsapp_message_log", "controlled_recipient_receipt"],
  failedClassifications: ["meta_whatsapp_message_log", "provider_rejection_log"],
  attemptPredicate: `
    AND delivery_attempt.channel = 'whatsapp'
    AND delivery_attempt.provider = 'whatsapp_cloud_api'
    AND delivery_attempt.watchlist_id IS NOT NULL
    AND delivery_attempt.digest_run_id IS NULL
    AND delivery_attempt.delivery_target_id IS NOT NULL
    AND delivery_attempt.idempotency_key LIKE 'instant:%:customer:whatsapp:%'
  `,
  allowsUnclassifiedFailure: true,
  allowsAcceptedProviderUnknown: false,
  requiresSettledProviderWindow: true,
  updatesDigestDelivery: false,
};

const INSTANT_SLACK_RECONCILIATION_SCOPE: DeliveryReconciliationScope = {
  actionName: "ops.instant_slack.reconcile",
  evidencePath: "$.instantAlertProviderEvidence",
  idempotencyPrefix: "ops-instant-slack-reconcile",
  label: "Instant alert Slack",
  lane: "customer",
  classifications: INSTANT_SLACK_EVIDENCE_CLASSIFICATIONS,
  sentClassifications: ["slack_webhook_response", "controlled_channel_observation"],
  failedClassifications: ["slack_webhook_response", "provider_rejection_log"],
  attemptPredicate: `
    AND delivery_attempt.channel = 'slack'
    AND delivery_attempt.provider = 'slack_incoming_webhook'
    AND delivery_attempt.watchlist_id IS NOT NULL
    AND delivery_attempt.digest_run_id IS NULL
    AND delivery_attempt.delivery_target_id IS NOT NULL
    AND delivery_attempt.idempotency_key LIKE 'instant:%:customer:slack:%'
  `,
  allowsUnclassifiedFailure: true,
  allowsAcceptedProviderUnknown: false,
  requiresSettledProviderWindow: true,
  updatesDigestDelivery: false,
};

const SUPPORT_ALERT_RECONCILIATION_SCOPE: DeliveryReconciliationScope = {
  actionName: "ops.support_alert.reconcile",
  evidencePath: "$.supportAlertProviderEvidence",
  idempotencyPrefix: "ops-support-alert-reconcile",
  label: "Support alert",
  lane: "internal",
  classifications: BILLING_EMAIL_EVIDENCE_CLASSIFICATIONS,
  sentClassifications: ["cloudflare_email_log", "controlled_inbox_receipt"],
  failedClassifications: ["cloudflare_email_log", "provider_rejection_log"],
  attemptPredicate: `
    AND delivery_attempt.channel = 'email'
    AND delivery_attempt.provider = 'cloudflare_email'
    AND (
      delivery_attempt.idempotency_key LIKE 'support-case:%'
      OR delivery_attempt.idempotency_key LIKE 'support-case-reopen:%'
    )
    AND json_extract(delivery_attempt.payload_snapshot_json, '$.kind') = 'support_case_operator_alert'
  `,
  allowsUnclassifiedFailure: false,
  allowsAcceptedProviderUnknown: true,
  requiresSettledProviderWindow: false,
  updatesDigestDelivery: false,
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

export function createInstantEmailReconciliationKey() {
  return `ops-instant-email-reconcile:${crypto.randomUUID()}`;
}

export function createInstantChannelReconciliationKey(channel: InstantDeliveryChannel) {
  if (channel === "email") return createInstantEmailReconciliationKey();
  return `ops-instant-${channel}-reconcile:${crypto.randomUUID()}`;
}

export function createSupportAlertReconciliationKey() {
  return `ops-support-alert-reconcile:${crypto.randomUUID()}`;
}

export async function reconcileBillingEmailAttemptWithAudit(
  env: AppEnv,
  input: DeliveryReconciliationInput,
) {
  return reconcileDeliveryAttemptWithAudit(env, input, BILLING_RECONCILIATION_SCOPE);
}

export async function reconcileDigestEmailAttemptWithAudit(
  env: AppEnv,
  input: DeliveryReconciliationInput,
) {
  return reconcileDeliveryAttemptWithAudit(env, input, DIGEST_RECONCILIATION_SCOPE);
}

export async function reconcileInstantEmailAttemptWithAudit(
  env: AppEnv,
  input: DeliveryReconciliationInput,
) {
  return reconcileDeliveryAttemptWithAudit(env, input, INSTANT_RECONCILIATION_SCOPE);
}

export async function reconcileInstantChannelAttemptWithAudit(
  env: AppEnv,
  input: DeliveryReconciliationInput & { channel: InstantDeliveryChannel },
) {
  const scope = input.channel === "email"
    ? INSTANT_RECONCILIATION_SCOPE
    : input.channel === "whatsapp"
      ? INSTANT_WHATSAPP_RECONCILIATION_SCOPE
      : INSTANT_SLACK_RECONCILIATION_SCOPE;
  return reconcileDeliveryAttemptWithAudit(env, input, scope);
}

export async function reconcileSupportAlertAttemptWithAudit(
  env: AppEnv,
  input: DeliveryReconciliationInput,
) {
  return reconcileDeliveryAttemptWithAudit(env, input, SUPPORT_ALERT_RECONCILIATION_SCOPE);
}

async function reconcileDeliveryAttemptWithAudit(
  env: AppEnv,
  input: DeliveryReconciliationInput,
  scope: DeliveryReconciliationScope,
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
    evidenceReference: normalized.evidenceReference,
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
      ? "Provider reconciliation confirmed this delivery was not accepted."
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
          AND delivery_attempt.lane = '${scope.lane}'
          ${reconciliationStatePredicate(scope, "delivery_attempt.")}
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
          AND lane = '${scope.lane}'
          ${reconciliationStatePredicate(scope, "")}
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
                WHEN digest_delivery.status = 'sent'
                  AND excluded.status != 'sent'
                  AND EXISTS (
                    SELECT 1
                    FROM delivery_attempt AS other_attempt
                    WHERE other_attempt.digest_run_id = digest_delivery.digest_run_id
                      AND other_attempt.id != ?
                      AND other_attempt.status = 'sent'
                  )
                  THEN digest_delivery.provider
                ELSE excluded.provider
              END,
              status = CASE
                WHEN digest_delivery.status = 'sent'
                  AND excluded.status != 'sent'
                  AND EXISTS (
                    SELECT 1
                    FROM delivery_attempt AS other_attempt
                    WHERE other_attempt.digest_run_id = digest_delivery.digest_run_id
                      AND other_attempt.id != ?
                      AND other_attempt.status = 'sent'
                  )
                  THEN 'sent'
                ELSE excluded.status
              END,
              recipient_email = CASE
                WHEN digest_delivery.status = 'sent'
                  AND excluded.status != 'sent'
                  AND EXISTS (
                    SELECT 1
                    FROM delivery_attempt AS other_attempt
                    WHERE other_attempt.digest_run_id = digest_delivery.digest_run_id
                      AND other_attempt.id != ?
                      AND other_attempt.status = 'sent'
                  )
                  THEN digest_delivery.recipient_email
                ELSE excluded.recipient_email
              END,
              external_message_id = CASE
                WHEN digest_delivery.status = 'sent'
                  AND excluded.status != 'sent'
                  AND EXISTS (
                    SELECT 1
                    FROM delivery_attempt AS other_attempt
                    WHERE other_attempt.digest_run_id = digest_delivery.digest_run_id
                      AND other_attempt.id != ?
                      AND other_attempt.status = 'sent'
                  )
                  THEN digest_delivery.external_message_id
                ELSE excluded.external_message_id
              END,
              error_message = CASE
                WHEN digest_delivery.status = 'sent'
                  AND excluded.status != 'sent'
                  AND EXISTS (
                    SELECT 1
                    FROM delivery_attempt AS other_attempt
                    WHERE other_attempt.digest_run_id = digest_delivery.digest_run_id
                      AND other_attempt.id != ?
                      AND other_attempt.status = 'sent'
                  )
                  THEN digest_delivery.error_message
                ELSE excluded.error_message
              END,
              delivered_at = CASE
                WHEN digest_delivery.status = 'sent'
                  AND excluded.status != 'sent'
                  AND EXISTS (
                    SELECT 1
                    FROM delivery_attempt AS other_attempt
                    WHERE other_attempt.digest_run_id = digest_delivery.digest_run_id
                      AND other_attempt.id != ?
                      AND other_attempt.status = 'sent'
                  )
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
          normalized.attemptId,
          normalized.attemptId,
          normalized.attemptId,
          normalized.attemptId,
          normalized.attemptId,
          normalized.attemptId,
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
    prior?.evidenceReference === normalized.evidenceReference &&
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

function normalizeInput(
  input: DeliveryReconciliationInput,
  scope: DeliveryReconciliationScope,
) {
  const operatorUserId = input.operatorUserId.trim();
  const attemptId = input.attemptId.trim();
  const expectedUpdatedAt = normalizeTimestamp(input.expectedUpdatedAt);
  const observedAtHasExplicitOffset = hasExplicitTimezoneOffset(input.observedAt);
  const observedAt = normalizeTimestamp(input.observedAt);
  const evidenceReference = input.evidenceReference.trim();
  const classification = scope.classifications.includes(input.classification)
    ? input.classification
    : null;
  const allowedForOutcome =
    input.outcome === "sent"
      ? Boolean(classification && scope.sentClassifications.includes(classification))
      : Boolean(classification && scope.failedClassifications.includes(classification));
  const observedTime = observedAt ? Date.parse(observedAt) : Number.NaN;
  if (
    !operatorUserId ||
    !attemptId ||
    !expectedUpdatedAt ||
    !observedAtHasExplicitOffset ||
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

function reconciliationStatePredicate(
  scope: DeliveryReconciliationScope,
  qualifier: "" | "delivery_attempt.",
) {
  const providerUnknown = `
    (
      ${qualifier}webhook_status = 'provider_unknown'
      AND (
        (
          ${qualifier}status = 'pending'
          ${scope.requiresSettledProviderWindow
            ? `AND julianday(${qualifier}updated_at) <= julianday('now', '-60 seconds')`
            : ""}
        )
        OR (
          ${qualifier}status = 'failed'
          ${scope.allowsUnclassifiedFailure
            ? ""
            : `AND ${qualifier}provider_status_last_seen_at IS NOT NULL`}
        )
        ${scope.allowsAcceptedProviderUnknown
          ? `OR ${qualifier}status = 'sent'`
          : ""}
      )
    )
  `;
  if (!scope.allowsUnclassifiedFailure) {
    return `AND ${providerUnknown}`;
  }
  return `
    AND (
      ${providerUnknown}
      OR (
        ${qualifier}status = 'failed'
        AND ${qualifier}webhook_status = 'failed'
        AND COALESCE(
          json_extract(${qualifier}payload_snapshot_json, '$.deliveryClaimProtocol'),
          ''
        ) != 'instant_preclaim_v1'
        AND COALESCE(
          json_extract(${qualifier}payload_snapshot_json, '$.instantAlertProviderEvidence.outcome'),
          ''
        ) != 'failed'
      )
    )
  `;
}

function normalizeTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function hasExplicitTimezoneOffset(value: string) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim());
}
