import { describe, expect, it } from "vitest";

import {
  PARTIAL_REFUND_PREFLIGHT_QUERY,
  parsePartialRefundPreflightOutput,
  partialRefundPreflightHasFindings,
} from "../scripts/partial-refund-preflight.lib.mjs";
import { createSqliteD1 } from "./helpers/sqlite-d1";

const zeroCounts = {
  negative_partial_refund_ledger_count: 0,
  orphan_partial_refund_ledger_count: 0,
  linked_partial_refund_legacy_credit_count: 0,
  unresolvable_partial_refund_event_count: 0,
  unclassified_refund_event_count: 0,
  unsafe_partial_refund_policy_count: 0,
  pending_partial_refund_reconciliation_count: 0,
  unhandled_refund_event_count: 0,
  inflight_refund_event_count: 0,
};

function wranglerOutput(row: Record<string, unknown>) {
  return JSON.stringify([{ results: [row], success: true }]);
}

describe("partial refund production preflight", () => {
  it("accepts one documented Wrangler result with no historical over-claw evidence", () => {
    const counts = parsePartialRefundPreflightOutput(wranglerOutput(zeroCounts));
    expect(counts).toEqual(zeroCounts);
    expect(partialRefundPreflightHasFindings(counts)).toBe(false);
  });

  it.each(Object.keys(zeroCounts))("blocks when %s is nonzero", (field) => {
    const counts = parsePartialRefundPreflightOutput(
      wranglerOutput({ ...zeroCounts, [field]: 1 }),
    );
    expect(partialRefundPreflightHasFindings(counts)).toBe(true);
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["failed query", JSON.stringify([{ results: [], success: false }])],
    ["missing result", JSON.stringify([{ results: [], success: true }])],
    ["invalid count", wranglerOutput({ ...zeroCounts, negative_partial_refund_ledger_count: -1 })],
  ])("rejects %s", (_label, output) => {
    expect(() => parsePartialRefundPreflightOutput(output)).toThrow();
  });

  it("detects old negative-ledger and legacy-credit partial refund damage", () => {
    const { sqlite, close } = createSqliteD1();
    sqlite.exec(`
      CREATE TABLE dodo_webhook_event (
        event_id TEXT PRIMARY KEY, event_type TEXT, outcome TEXT,
        processed_at TEXT, metadata_json TEXT
      );
      CREATE TABLE evidence_top_up_ledger_entry (
        id TEXT PRIMARY KEY, grant_id TEXT, workspace_user_id TEXT,
        entry_type TEXT, quantity_delta INTEGER,
        idempotency_key TEXT, metadata_json TEXT
      );
      CREATE TABLE evidence_top_up_grant (
        id TEXT PRIMARY KEY, workspace_user_id TEXT, provider_payment_id TEXT
      );
      CREATE TABLE proof_usage_credit (
        id TEXT PRIMARY KEY, provider_payment_id TEXT, expires_at TEXT
      );
      CREATE TABLE agent_action_audit (
        id TEXT PRIMARY KEY, action_name TEXT, resource_type TEXT,
        resource_id TEXT, status TEXT, idempotency_key TEXT, metadata_json TEXT
      );
      INSERT INTO dodo_webhook_event VALUES (
        'evt-partial', 'refund.succeeded', 'processed', '2026-07-17T00:00:00.000Z',
        '{"action":"refund","paymentId":"pay-1","refundId":"ref-1","refundType":"partial"}'
      );
      INSERT INTO evidence_top_up_ledger_entry VALUES (
        'ledger-partial', 'grant-1', 'owner-1', 'refund', -120,
        'dodo-refund:evt-partial:pay-1',
        '{"reason":"partial_provider_refund","providerEventId":"evt-partial"}'
      );
      INSERT INTO evidence_top_up_grant VALUES ('grant-1', 'owner-1', 'pay-1');
      INSERT INTO proof_usage_credit VALUES (
        'legacy-credit', 'pay-1', '2026-07-17T00:00:00.000Z'
      );
    `);
    const row = sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get() as Record<string, number>;
    expect(row).toEqual({
      negative_partial_refund_ledger_count: 1,
      orphan_partial_refund_ledger_count: 0,
      linked_partial_refund_legacy_credit_count: 1,
      unresolvable_partial_refund_event_count: 0,
      unclassified_refund_event_count: 0,
      unsafe_partial_refund_policy_count: 1,
      pending_partial_refund_reconciliation_count: 0,
      unhandled_refund_event_count: 0,
      inflight_refund_event_count: 0,
    });

    sqlite.exec(`
      INSERT INTO evidence_top_up_ledger_entry VALUES (
        'operator-compensation', 'grant-1', 'owner-1', 'adjustment', 120,
        'operator-refund:evt-partial:pay-1:v1',
        '{"reason":"provider_evidence_reconciliation","providerEventId":"evt-partial"}'
      );
      UPDATE dodo_webhook_event
      SET metadata_json = json_set(
        metadata_json,
        '$.refundReconciliationStatus', 'resolved',
        '$.refundReconciliationDecision', 'retain',
        '$.refundReconciliationObservedAt', '2026-07-17T01:00:00.000Z',
        '$.refundReconciliationEvidenceReference', 'provider-ref-1',
        '$.refundReconciliationRequestedQuantity', 0,
        '$.refundReconciliationAppliedQuantity', 0
      )
      WHERE event_id = 'evt-partial';
      INSERT INTO agent_action_audit VALUES (
        'audit-partial', 'billing.partial_refund.reconcile', 'dodo_webhook_event',
        'evt-partial', 'succeeded', 'billing-partial-refund-reconcile:evt-partial:v1',
        '{"decision":"retain","paymentId":"pay-1","refundId":"ref-1","requestedQuantity":0,"appliedQuantity":0,"evidenceReference":"provider-ref-1","observedAt":"2026-07-17T01:00:00.000Z"}'
      );
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual(zeroCounts);

    sqlite.exec(`
      DELETE FROM agent_action_audit;
      DELETE FROM evidence_top_up_ledger_entry;
      DELETE FROM proof_usage_credit;
      DELETE FROM dodo_webhook_event;
      INSERT INTO dodo_webhook_event VALUES (
        'evt-clean-partial', 'refund.succeeded', 'processed', '2026-07-18T00:00:00.000Z',
        '{"action":"refund","paymentId":"pay-clean","refundId":"ref-clean","refundType":"partial","creditMutationPolicy":"audit_only_v2","refundReconciliationStatus":"pending"}'
      );
      INSERT INTO proof_usage_credit VALUES (
        'legacy-clean', 'pay-clean', '2099-01-01T00:00:00.000Z'
      );
      INSERT INTO evidence_top_up_grant VALUES ('grant-clean', 'owner-clean', 'pay-clean');
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual({
      negative_partial_refund_ledger_count: 0,
      orphan_partial_refund_ledger_count: 0,
      linked_partial_refund_legacy_credit_count: 0,
      unresolvable_partial_refund_event_count: 0,
      unclassified_refund_event_count: 0,
      unsafe_partial_refund_policy_count: 0,
      pending_partial_refund_reconciliation_count: 1,
      unhandled_refund_event_count: 0,
      inflight_refund_event_count: 0,
    });

    sqlite.exec(`
      INSERT INTO evidence_top_up_ledger_entry VALUES (
        'operator-clean', 'grant-clean', 'owner-clean', 'refund', 0,
        'operator-refund:evt-clean-partial:pay-clean:v1',
        '{"reason":"partial_provider_refund","providerEventId":"evt-clean-partial"}'
      );
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toMatchObject({
      pending_partial_refund_reconciliation_count: 1,
    });
    sqlite.exec(`
      UPDATE dodo_webhook_event
      SET metadata_json = json_set(
        metadata_json,
        '$.refundReconciliationStatus', 'resolved',
        '$.refundReconciliationDecision', 'retain',
        '$.refundReconciliationObservedAt', '2026-07-18T01:00:00.000Z',
        '$.refundReconciliationEvidenceReference', 'provider-ref-clean',
        '$.refundReconciliationRequestedQuantity', 0,
        '$.refundReconciliationAppliedQuantity', 0
      )
      WHERE event_id = 'evt-clean-partial';
      INSERT INTO agent_action_audit VALUES (
        'audit-clean', 'billing.partial_refund.reconcile', 'dodo_webhook_event',
        'evt-clean-partial', 'succeeded',
        'billing-partial-refund-reconcile:evt-clean-partial:v1',
        '{"decision":"retain","paymentId":"pay-clean","refundId":"ref-clean","requestedQuantity":0,"appliedQuantity":0,"evidenceReference":"provider-ref-clean","observedAt":"2026-07-18T01:00:00.000Z"}'
      );
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual(zeroCounts);

    close();
  });

  it("fails closed on unclassified, unresolvable, and in-flight refunds", () => {
    const { sqlite, close } = createSqliteD1();
    sqlite.exec(`
      CREATE TABLE dodo_webhook_event (
        event_id TEXT PRIMARY KEY, event_type TEXT, outcome TEXT,
        processed_at TEXT, metadata_json TEXT
      );
      CREATE TABLE evidence_top_up_ledger_entry (
        id TEXT PRIMARY KEY, grant_id TEXT, workspace_user_id TEXT,
        entry_type TEXT, quantity_delta INTEGER,
        idempotency_key TEXT, metadata_json TEXT
      );
      CREATE TABLE evidence_top_up_grant (
        id TEXT PRIMARY KEY, workspace_user_id TEXT, provider_payment_id TEXT
      );
      CREATE TABLE proof_usage_credit (
        id TEXT PRIMARY KEY, provider_payment_id TEXT, expires_at TEXT
      );
      CREATE TABLE agent_action_audit (
        id TEXT PRIMARY KEY, action_name TEXT, resource_type TEXT,
        resource_id TEXT, status TEXT, idempotency_key TEXT, metadata_json TEXT
      );
      INSERT INTO dodo_webhook_event VALUES
        ('evt-unknown', 'refund.succeeded', 'processed', '2026-07-17T00:00:00.000Z',
          '{"action":"refund","paymentId":"pay-unknown"}'),
        ('evt-actionless', 'refund.succeeded', 'processed', '2026-07-17T00:00:00.000Z',
          '{"paymentId":"pay-actionless","refundId":"ref-actionless","refundType":"full"}'),
        ('evt-unresolvable', 'refund.succeeded', 'processed', '2026-07-17T00:00:00.000Z',
          '{"action":"refund","paymentId":"pay-partial","refundType":"partial","creditMutationPolicy":"audit_only_v2","refundReconciliationStatus":"pending"}'),
        ('evt-inflight', 'refund.succeeded', 'processing', NULL, '{}'),
        ('evt-failed', 'refund.succeeded', 'failed', NULL, '{}'),
        ('evt-ignored', 'refund.succeeded', 'ignored', '2026-07-17T00:00:00.000Z', '{}');
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual({
      ...zeroCounts,
      unclassified_refund_event_count: 2,
      unresolvable_partial_refund_event_count: 1,
      pending_partial_refund_reconciliation_count: 1,
      unhandled_refund_event_count: 1,
      inflight_refund_event_count: 2,
    });
    close();
  });

  it("requires resolved event metadata to match one nonblank succeeded audit", () => {
    const { sqlite, close } = createSqliteD1();
    sqlite.exec(`
      CREATE TABLE dodo_webhook_event (
        event_id TEXT PRIMARY KEY, event_type TEXT, outcome TEXT,
        processed_at TEXT, metadata_json TEXT
      );
      CREATE TABLE evidence_top_up_ledger_entry (
        id TEXT PRIMARY KEY, grant_id TEXT, workspace_user_id TEXT,
        entry_type TEXT, quantity_delta INTEGER,
        idempotency_key TEXT, metadata_json TEXT
      );
      CREATE TABLE evidence_top_up_grant (
        id TEXT PRIMARY KEY, workspace_user_id TEXT, provider_payment_id TEXT
      );
      CREATE TABLE proof_usage_credit (
        id TEXT PRIMARY KEY, provider_payment_id TEXT, expires_at TEXT
      );
      CREATE TABLE agent_action_audit (
        id TEXT PRIMARY KEY, action_name TEXT, resource_type TEXT,
        resource_id TEXT, status TEXT, idempotency_key TEXT, metadata_json TEXT
      );
      INSERT INTO dodo_webhook_event VALUES (
        'evt-resolved', 'refund.succeeded', 'processed', '2026-07-18T00:00:00.000Z',
        '{"action":"refund","paymentId":"pay-resolved","refundId":"ref-resolved","refundType":"partial","creditMutationPolicy":"audit_only_v2","refundReconciliationStatus":"resolved","refundReconciliationDecision":"retain","refundReconciliationObservedAt":"2026-07-18T01:00:00.000Z","refundReconciliationEvidenceReference":"provider-ref-resolved","refundReconciliationRequestedQuantity":0,"refundReconciliationAppliedQuantity":0}'
      );
      INSERT INTO agent_action_audit VALUES (
        'audit-resolved', 'billing.partial_refund.reconcile', 'dodo_webhook_event',
        'evt-resolved', 'succeeded', 'billing-partial-refund-reconcile:evt-resolved:v1',
        '{"decision":"retain","paymentId":"pay-resolved","refundId":"ref-resolved","requestedQuantity":0,"appliedQuantity":0,"evidenceReference":"   ","observedAt":"2026-07-18T01:00:00.000Z"}'
      );
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual({
      ...zeroCounts,
      unresolvable_partial_refund_event_count: 1,
    });

    sqlite.exec(`
      UPDATE agent_action_audit
      SET metadata_json = json_set(
        metadata_json,
        '$.evidenceReference', 'provider-ref-resolved'
      )
      WHERE id = 'audit-resolved'
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual(zeroCounts);

    sqlite.exec(`
      UPDATE dodo_webhook_event
      SET metadata_json = json_set(
        metadata_json,
        '$.paymentId', 123,
        '$.refundId', 456
      )
      WHERE event_id = 'evt-resolved';
      UPDATE agent_action_audit
      SET metadata_json = json_set(
        metadata_json,
        '$.paymentId', 123,
        '$.refundId', 456
      )
      WHERE id = 'audit-resolved';
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual({
      ...zeroCounts,
      unresolvable_partial_refund_event_count: 1,
    });

    sqlite.exec(`
      UPDATE dodo_webhook_event
      SET metadata_json = json_set(
        metadata_json,
        '$.paymentId', 'pay-resolved',
        '$.refundId', 'ref-resolved'
      )
      WHERE event_id = 'evt-resolved';
      UPDATE agent_action_audit
      SET metadata_json = json_set(
        metadata_json,
        '$.paymentId', 'pay-resolved',
        '$.refundId', 'ref-resolved'
      )
      WHERE id = 'audit-resolved';
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual(zeroCounts);

    sqlite.exec(`
      UPDATE dodo_webhook_event
      SET metadata_json = json_set(
        metadata_json,
        '$.refundReconciliationRequestedQuantity', 1,
        '$.refundReconciliationAppliedQuantity', 1
      )
      WHERE event_id = 'evt-resolved';
      UPDATE agent_action_audit
      SET metadata_json = json_set(
        metadata_json,
        '$.requestedQuantity', 1,
        '$.appliedQuantity', 1
      )
      WHERE id = 'audit-resolved';
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual({
      ...zeroCounts,
      unresolvable_partial_refund_event_count: 1,
    });

    sqlite.exec(`
      UPDATE dodo_webhook_event
      SET metadata_json = json_set(
        metadata_json,
        '$.refundReconciliationRequestedQuantity', 0,
        '$.refundReconciliationAppliedQuantity', 0,
        '$.refundReconciliationObservedAt', 'not-a-time'
      )
      WHERE event_id = 'evt-resolved';
      UPDATE agent_action_audit
      SET metadata_json = json_set(
        metadata_json,
        '$.requestedQuantity', 0,
        '$.appliedQuantity', 0,
        '$.observedAt', 'not-a-time'
      )
      WHERE id = 'audit-resolved';
    `);
    expect(sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual({
      ...zeroCounts,
      unresolvable_partial_refund_event_count: 1,
    });
    close();
  });
});
