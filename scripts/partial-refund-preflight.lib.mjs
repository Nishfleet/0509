const COUNT_FIELDS = [
  "negative_partial_refund_ledger_count",
  "orphan_partial_refund_ledger_count",
  "linked_partial_refund_legacy_credit_count",
  "unresolvable_partial_refund_event_count",
  "unclassified_refund_event_count",
  "unsafe_partial_refund_policy_count",
  "pending_partial_refund_reconciliation_count",
  "unhandled_refund_event_count",
  "inflight_refund_event_count",
];

export const PARTIAL_REFUND_PREFLIGHT_QUERY = `
  WITH refund_events AS (
    SELECT event_id,
           json_extract(metadata_json, '$.action') AS action,
           json_extract(metadata_json, '$.paymentId') AS payment_id,
           TYPEOF(json_extract(metadata_json, '$.paymentId')) AS payment_id_type,
           json_extract(metadata_json, '$.refundId') AS refund_id,
           TYPEOF(json_extract(metadata_json, '$.refundId')) AS refund_id_type,
           json_extract(metadata_json, '$.refundType') AS refund_type,
           json_extract(metadata_json, '$.creditMutationPolicy') AS credit_mutation_policy,
           json_extract(metadata_json, '$.refundReconciliationStatus') AS reconciliation_status,
           json_extract(metadata_json, '$.refundReconciliationDecision') AS reconciliation_decision,
           json_extract(metadata_json, '$.refundReconciliationObservedAt') AS reconciliation_observed_at,
           json_extract(metadata_json, '$.refundReconciliationEvidenceReference') AS reconciliation_evidence_reference,
           json_extract(metadata_json, '$.refundReconciliationRequestedQuantity') AS reconciliation_requested_quantity,
           json_extract(metadata_json, '$.refundReconciliationAppliedQuantity') AS reconciliation_applied_quantity,
           processed_at
    FROM dodo_webhook_event
    WHERE event_type = 'refund.succeeded'
      AND outcome = 'processed'
  ),
  partial_events AS (
    SELECT * FROM refund_events WHERE refund_type = 'partial'
  ),
  partial_ledger AS (
    SELECT id,
           quantity_delta,
           json_extract(metadata_json, '$.providerEventId') AS provider_event_id
    FROM evidence_top_up_ledger_entry
    WHERE entry_type = 'refund'
      AND quantity_delta < 0
      AND idempotency_key LIKE 'dodo-refund:%'
      AND json_extract(metadata_json, '$.reason') = 'partial_provider_refund'
  ),
  operator_resolutions AS (
    SELECT DISTINCT audit.resource_id AS provider_event_id
    FROM agent_action_audit AS audit
    JOIN partial_events AS event
      ON event.event_id = audit.resource_id
    WHERE audit.action_name = 'billing.partial_refund.reconcile'
      AND audit.resource_type = 'dodo_webhook_event'
      AND audit.status = 'succeeded'
      AND audit.idempotency_key = 'billing-partial-refund-reconcile:' || audit.resource_id || ':v1'
      AND event.action = 'refund'
      AND event.payment_id_type = 'text'
      AND event.refund_id_type = 'text'
      AND event.reconciliation_status = 'resolved'
      AND TYPEOF(json_extract(audit.metadata_json, '$.paymentId')) = 'text'
      AND TYPEOF(json_extract(audit.metadata_json, '$.refundId')) = 'text'
      AND json_extract(audit.metadata_json, '$.paymentId') = event.payment_id
      AND json_extract(audit.metadata_json, '$.refundId') = event.refund_id
      AND TYPEOF(json_extract(audit.metadata_json, '$.evidenceReference')) = 'text'
      AND TYPEOF(json_extract(audit.metadata_json, '$.observedAt')) = 'text'
      AND LENGTH(TRIM(COALESCE(
            json_extract(audit.metadata_json, '$.evidenceReference'), ''
          ))) BETWEEN 1 AND 512
      AND INSTR(json_extract(audit.metadata_json, '$.evidenceReference'), CHAR(0)) = 0
      AND NOT (
        json_extract(audit.metadata_json, '$.evidenceReference') GLOB
        ('*[' || CHAR(1) || '-' || CHAR(31) || CHAR(127) || ']*')
      )
      AND INSTR(json_extract(audit.metadata_json, '$.evidenceReference'), '<') = 0
      AND INSTR(json_extract(audit.metadata_json, '$.evidenceReference'), '>') = 0
      AND LENGTH(json_extract(audit.metadata_json, '$.observedAt')) = 24
      AND SUBSTR(json_extract(audit.metadata_json, '$.observedAt'), 5, 1) = '-'
      AND SUBSTR(json_extract(audit.metadata_json, '$.observedAt'), 8, 1) = '-'
      AND SUBSTR(json_extract(audit.metadata_json, '$.observedAt'), 11, 1) = 'T'
      AND SUBSTR(json_extract(audit.metadata_json, '$.observedAt'), 14, 1) = ':'
      AND SUBSTR(json_extract(audit.metadata_json, '$.observedAt'), 17, 1) = ':'
      AND SUBSTR(json_extract(audit.metadata_json, '$.observedAt'), 20, 1) = '.'
      AND SUBSTR(json_extract(audit.metadata_json, '$.observedAt'), 24, 1) = 'Z'
      AND DATETIME(json_extract(audit.metadata_json, '$.observedAt')) IS NOT NULL
      AND json_extract(audit.metadata_json, '$.decision') = event.reconciliation_decision
      AND json_extract(audit.metadata_json, '$.observedAt') = event.reconciliation_observed_at
      AND json_extract(audit.metadata_json, '$.evidenceReference') =
          event.reconciliation_evidence_reference
      AND json_extract(audit.metadata_json, '$.requestedQuantity') =
          event.reconciliation_requested_quantity
      AND json_extract(audit.metadata_json, '$.appliedQuantity') =
          event.reconciliation_applied_quantity
      AND (
        (
          json_extract(audit.metadata_json, '$.decision') = 'retain'
          AND TYPEOF(json_extract(audit.metadata_json, '$.requestedQuantity')) = 'integer'
          AND TYPEOF(json_extract(audit.metadata_json, '$.appliedQuantity')) = 'integer'
          AND json_extract(audit.metadata_json, '$.requestedQuantity') = 0
          AND json_extract(audit.metadata_json, '$.appliedQuantity') = 0
          AND (
            NOT EXISTS (
              SELECT 1 FROM partial_ledger
              WHERE partial_ledger.provider_event_id = event.event_id
            )
            OR EXISTS (
              SELECT 1
              FROM evidence_top_up_ledger_entry AS compensation
              WHERE compensation.idempotency_key =
                      'operator-refund:' || event.event_id || ':' || event.payment_id || ':v1'
                AND compensation.entry_type = 'adjustment'
                AND compensation.quantity_delta = -1 * (
                  SELECT COALESCE(SUM(damage.quantity_delta), 0)
                  FROM partial_ledger AS damage
                  WHERE damage.provider_event_id = event.event_id
                )
                AND json_extract(compensation.metadata_json, '$.providerEventId') = event.event_id
                AND json_extract(compensation.metadata_json, '$.reason') =
                    'provider_evidence_reconciliation'
                AND EXISTS (
                  SELECT 1
                  FROM evidence_top_up_grant AS compensation_grant
                  WHERE compensation_grant.id = compensation.grant_id
                    AND compensation_grant.workspace_user_id = compensation.workspace_user_id
                    AND compensation_grant.provider_payment_id = event.payment_id
                )
            )
          )
        )
        OR (
          json_extract(audit.metadata_json, '$.decision') = 'revoke'
          AND TYPEOF(json_extract(audit.metadata_json, '$.requestedQuantity')) = 'integer'
          AND TYPEOF(json_extract(audit.metadata_json, '$.appliedQuantity')) = 'integer'
          AND json_extract(audit.metadata_json, '$.requestedQuantity') > 0
          AND json_extract(audit.metadata_json, '$.appliedQuantity') > 0
          AND json_extract(audit.metadata_json, '$.appliedQuantity') <=
              json_extract(audit.metadata_json, '$.requestedQuantity')
          AND NOT EXISTS (
            SELECT 1 FROM partial_ledger
            WHERE partial_ledger.provider_event_id = event.event_id
          )
          AND EXISTS (
            SELECT 1
            FROM evidence_top_up_ledger_entry AS resolution_ledger
            WHERE resolution_ledger.idempotency_key =
                    'operator-refund:' || audit.resource_id || ':' ||
                    json_extract(audit.metadata_json, '$.paymentId') || ':v1'
              AND resolution_ledger.entry_type = 'refund'
              AND resolution_ledger.quantity_delta < 0
              AND json_extract(resolution_ledger.metadata_json, '$.providerEventId') = audit.resource_id
              AND json_extract(resolution_ledger.metadata_json, '$.reason') = 'partial_provider_refund'
              AND -resolution_ledger.quantity_delta =
                  json_extract(audit.metadata_json, '$.appliedQuantity')
              AND EXISTS (
                SELECT 1
                FROM evidence_top_up_grant AS resolution_grant
                WHERE resolution_grant.id = resolution_ledger.grant_id
                  AND resolution_grant.workspace_user_id =
                      resolution_ledger.workspace_user_id
                  AND resolution_grant.provider_payment_id = event.payment_id
              )
          )
        )
      )
  )
  SELECT
    (SELECT COUNT(*)
       FROM partial_ledger AS ledger
       LEFT JOIN operator_resolutions AS resolution
         ON resolution.provider_event_id = ledger.provider_event_id
      WHERE resolution.provider_event_id IS NULL)
      AS negative_partial_refund_ledger_count,
    (SELECT COUNT(*)
       FROM partial_ledger AS ledger
       LEFT JOIN partial_events AS event
         ON event.event_id = ledger.provider_event_id
      WHERE event.event_id IS NULL) AS orphan_partial_refund_ledger_count,
    (SELECT COUNT(*)
       FROM proof_usage_credit AS credit
       JOIN partial_events AS event
         ON event.payment_id = credit.provider_payment_id
       LEFT JOIN operator_resolutions AS resolution
         ON resolution.provider_event_id = event.event_id
      WHERE COALESCE(event.credit_mutation_policy, '') != 'audit_only_v2'
        AND resolution.provider_event_id IS NULL)
      AS linked_partial_refund_legacy_credit_count,
    (SELECT COUNT(*)
       FROM partial_events
      WHERE action IS NULL OR action != 'refund'
         OR payment_id_type != 'text' OR payment_id = ''
         OR refund_id_type != 'text' OR refund_id = ''
         OR processed_at IS NULL
         OR (
           credit_mutation_policy = 'audit_only_v2'
           AND COALESCE(reconciliation_status, '') NOT IN ('pending', 'resolved')
         )
         OR (
           reconciliation_status = 'resolved'
           AND NOT EXISTS (
             SELECT 1 FROM operator_resolutions AS resolution
             WHERE resolution.provider_event_id = partial_events.event_id
           )
         )) AS unresolvable_partial_refund_event_count,
    (SELECT COUNT(*)
       FROM refund_events
      WHERE action IS NULL OR action != 'refund'
         OR COALESCE(refund_type, '') NOT IN ('full', 'partial'))
      AS unclassified_refund_event_count,
    (SELECT COUNT(*)
       FROM partial_events AS event
       LEFT JOIN operator_resolutions AS resolution
         ON resolution.provider_event_id = event.event_id
      WHERE COALESCE(event.credit_mutation_policy, '') != 'audit_only_v2'
        AND resolution.provider_event_id IS NULL)
      AS unsafe_partial_refund_policy_count,
    (SELECT COUNT(*)
       FROM partial_events AS event
       LEFT JOIN operator_resolutions AS resolution
         ON resolution.provider_event_id = event.event_id
      WHERE event.credit_mutation_policy = 'audit_only_v2'
        AND event.reconciliation_status = 'pending'
        AND resolution.provider_event_id IS NULL)
      AS pending_partial_refund_reconciliation_count,
    (SELECT COUNT(*)
      FROM dodo_webhook_event
      WHERE event_type = 'refund.succeeded'
        AND (outcome IS NULL OR outcome NOT IN ('processed', 'received', 'processing', 'failed')))
      AS unhandled_refund_event_count,
    (SELECT COUNT(*)
      FROM dodo_webhook_event
      WHERE event_type = 'refund.succeeded'
        AND outcome IN ('received', 'processing', 'failed'))
      AS inflight_refund_event_count;
`;

/**
 * Parse Wrangler's documented `d1 execute --json` response and fail closed
 * unless the historical partial-refund audit returned one trustworthy row.
 *
 * @param {string} output
 * @returns {Record<string, number>}
 */
export function parsePartialRefundPreflightOutput(output) {
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new Error("partial refund preflight returned malformed JSON");
  }

  const execution = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
  if (!execution || execution.success !== true) {
    throw new Error("partial refund preflight query did not succeed");
  }
  const row = Array.isArray(execution.results) && execution.results.length === 1
    ? execution.results[0]
    : null;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("partial refund preflight returned an invalid result row");
  }

  /** @type {Record<string, number>} */
  const counts = {};
  for (const field of COUNT_FIELDS) {
    const value = row[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`partial refund preflight returned an invalid ${field}`);
    }
    counts[field] = value;
  }
  return counts;
}

/** @param {Record<string, number>} counts */
export function partialRefundPreflightHasFindings(counts) {
  return COUNT_FIELDS.some((field) => counts[field] > 0);
}
