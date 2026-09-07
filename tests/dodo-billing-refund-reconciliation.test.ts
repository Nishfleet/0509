import { afterEach, describe, expect, it } from "vitest";

import {
  listPendingPartialRefundReconciliations,
  partialRefundLedgerKey,
  reconcilePartialRefundWithAudit,
} from "~/lib/data.server";
import { PARTIAL_REFUND_PREFLIGHT_QUERY } from "../scripts/partial-refund-preflight.lib.mjs";
import { createSqliteD1 } from "./helpers/sqlite-d1";

function seedSchema(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
  sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
    INSERT INTO user (id) VALUES ('owner-1'), ('operator-1');

    CREATE TABLE dodo_webhook_event (
      event_id TEXT PRIMARY KEY NOT NULL,
      event_type TEXT NOT NULL,
      outcome TEXT NOT NULL,
      processed_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE evidence_top_up_grant (
      id TEXT PRIMARY KEY,
      workspace_user_id TEXT NOT NULL,
      sku_slug TEXT NOT NULL,
      provider_payment_id TEXT NOT NULL,
      provider_product_id TEXT NOT NULL,
      quantity_granted INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      granted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      catalog_version TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE UNIQUE INDEX idx_evidence_top_up_grant_payment
      ON evidence_top_up_grant(provider_payment_id);

    CREATE TABLE evidence_top_up_ledger_entry (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      workspace_user_id TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      reservation_id TEXT,
      idempotency_key TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_evidence_top_up_ledger_idempotency
      ON evidence_top_up_ledger_entry(idempotency_key);

    CREATE TABLE agent_action_audit (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      api_key_id TEXT,
      action_name TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      idempotency_key TEXT,
      status TEXT NOT NULL,
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_agent_action_audit_user_idempotency
      ON agent_action_audit(user_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE TABLE proof_usage_credit (
      id TEXT PRIMARY KEY,
      provider_payment_id TEXT,
      expires_at TEXT
    );

    INSERT INTO evidence_top_up_grant (
      id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id,
      quantity_granted, quantity_remaining, granted_at, status
    ) VALUES (
      'grant-1', 'owner-1', 'proof-topup', 'pay-1', 'prod-proof',
      10, 10, '2026-07-17T00:00:00.000Z', 'active'
    );
    INSERT INTO dodo_webhook_event (
      event_id, event_type, outcome, processed_at, metadata_json
    ) VALUES (
      'evt-partial-1', 'refund.succeeded', 'processed', '2026-07-17T01:00:00.000Z',
      '{"action":"refund","paymentId":"pay-1","refundId":"ref-1","refundType":"partial","refundAmount":500,"refundCurrency":"USD","refundReason":"provider-confirmed","creditMutationPolicy":"audit_only_v2","refundReconciliationStatus":"pending"}'
    );
  `);
}

describe("partial-refund operator reconciliation", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length) fixtures.pop()?.close();
  });

  function openEnv() {
    const harness = createSqliteD1();
    fixtures.push(harness);
    seedSchema(harness.sqlite);
    return { harness, env: { DB: harness.db } as never };
  }

  const baseInput = {
    operatorUserId: "operator-1",
    eventId: "evt-partial-1",
    expectedProcessedAt: "2026-07-17T01:00:00.000Z",
    evidenceReference: "dodo-refund-observation-1",
    observedAt: "2026-07-17T02:00:00.000Z",
  } as const;

  it("lists only actionable pending partial refunds", async () => {
    const { harness, env } = openEnv();
    expect(await listPendingPartialRefundReconciliations(env)).toEqual([
      expect.objectContaining({
        eventId: "evt-partial-1",
        paymentId: "pay-1",
        refundId: "ref-1",
        processedAt: "2026-07-17T01:00:00.000Z",
        availableCredits: 10,
      }),
    ]);

    harness.sqlite.exec(`
      UPDATE dodo_webhook_event
      SET metadata_json = json_remove(metadata_json, '$.refundId')
      WHERE event_id = 'evt-partial-1'
    `);
    expect(await listPendingPartialRefundReconciliations(env)).toEqual([]);
  });

  it("accepts provider and operator identifiers containing underscores", async () => {
    const { env } = openEnv();
    await expect(reconcilePartialRefundWithAudit(env, {
      ...baseInput,
      operatorUserId: "operator_1",
      eventId: "evt_missing_1",
      decision: "retain",
      creditQuantityToRevoke: 0,
    })).resolves.toEqual({ reconciled: false, reason: "stale" });
  });

  it("retains credits with an atomic audit and supports only exact replay", async () => {
    const { harness, env } = openEnv();
    const input = { ...baseInput, decision: "retain" as const, creditQuantityToRevoke: 0 };
    await expect(reconcilePartialRefundWithAudit(env, input)).resolves.toMatchObject({
      reconciled: true,
      replayed: false,
      appliedQuantity: 0,
      decision: "retain",
    });
    expect(harness.sqlite.prepare(
      "SELECT json_extract(metadata_json, '$.refundReconciliationStatus') AS status FROM dodo_webhook_event",
    ).get()).toEqual({ status: "resolved" });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry").get())
      .toEqual({ count: 0 });
    expect(harness.sqlite.prepare(
      "SELECT action_name AS actionName, status FROM agent_action_audit",
    ).get()).toEqual({ actionName: "billing.partial_refund.reconcile", status: "succeeded" });

    await expect(reconcilePartialRefundWithAudit(env, input)).resolves.toMatchObject({
      reconciled: true,
      replayed: true,
    });
    await expect(reconcilePartialRefundWithAudit(env, {
      ...input,
      evidenceReference: "different-provider-evidence",
    })).resolves.toEqual({ reconciled: false, reason: "idempotency_conflict" });
  });

  it("revokes no more than available credits and records one attributable ledger entry", async () => {
    const { harness, env } = openEnv();
    await expect(reconcilePartialRefundWithAudit(env, {
      ...baseInput,
      decision: "revoke",
      creditQuantityToRevoke: 50,
    })).resolves.toMatchObject({
      reconciled: true,
      appliedQuantity: 10,
      decision: "revoke",
    });
    expect(harness.sqlite.prepare(`
      SELECT quantity_delta AS quantityDelta, idempotency_key AS idempotencyKey,
             json_extract(metadata_json, '$.providerEventId') AS providerEventId
      FROM evidence_top_up_ledger_entry
    `).get()).toEqual({
      quantityDelta: -10,
      idempotencyKey: partialRefundLedgerKey("evt-partial-1", "pay-1"),
      providerEventId: "evt-partial-1",
    });
    expect(harness.sqlite.prepare(
      "SELECT quantity_remaining AS remaining, status FROM evidence_top_up_grant",
    ).get()).toEqual({ remaining: 0, status: "depleted" });
    expect(harness.sqlite.prepare(`
      SELECT json_extract(metadata_json, '$.appliedQuantity') AS appliedQuantity
      FROM agent_action_audit
    `).get()).toEqual({ appliedQuantity: 10 });
    expect(harness.sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toEqual({
      negative_partial_refund_ledger_count: 0,
      orphan_partial_refund_ledger_count: 0,
      linked_partial_refund_legacy_credit_count: 0,
      unresolvable_partial_refund_event_count: 0,
      unclassified_refund_event_count: 0,
      unsafe_partial_refund_policy_count: 0,
      pending_partial_refund_reconciliation_count: 0,
      unhandled_refund_event_count: 0,
      inflight_refund_event_count: 0,
    });

    harness.sqlite.exec(`
      UPDATE evidence_top_up_grant
      SET provider_payment_id = 'pay-wrong'
      WHERE id = 'grant-1'
    `);
    expect(harness.sqlite.prepare(PARTIAL_REFUND_PREFLIGHT_QUERY).get()).toMatchObject({
      unresolvable_partial_refund_event_count: 1,
    });
  });

  it("fails closed when concurrent consumption invalidates the observed balance", async () => {
    const { harness } = openEnv();
    const baseDb = harness.db;
    let injected = false;
    const guardedDb = {
      ...baseDb,
      async batch(statements: Parameters<typeof baseDb.batch>[0]) {
        if (!injected) {
          injected = true;
          harness.sqlite.exec(`
            INSERT INTO evidence_top_up_ledger_entry VALUES (
              'concurrent-use', 'grant-1', 'owner-1', -10, 'consumption', NULL,
              'concurrent-use-1', '{}', '2026-07-17T01:30:00.000Z'
            )
          `);
        }
        return baseDb.batch(statements);
      },
    };
    const env = { DB: guardedDb } as never;

    await expect(reconcilePartialRefundWithAudit(env, {
      ...baseInput,
      decision: "revoke",
      creditQuantityToRevoke: 10,
    })).resolves.toEqual({ reconciled: false, reason: "stale" });
    expect(harness.sqlite.prepare(
      "SELECT COALESCE(SUM(quantity_delta), 0) AS delta FROM evidence_top_up_ledger_entry",
    ).get()).toEqual({ delta: -10 });
    expect(harness.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE idempotency_key LIKE 'operator-refund:%'",
    ).get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get())
      .toEqual({ count: 0 });
  });

  it("rolls back every reconciliation effect when a late batch statement fails", async () => {
    const { harness, env } = openEnv();
    harness.sqlite.exec(`
      CREATE TRIGGER fail_partial_refund_audit
      BEFORE INSERT ON agent_action_audit
      WHEN NEW.action_name = 'billing.partial_refund.reconcile'
      BEGIN
        SELECT RAISE(ABORT, 'injected late audit failure');
      END;
    `);

    await expect(reconcilePartialRefundWithAudit(env, {
      ...baseInput,
      decision: "revoke",
      creditQuantityToRevoke: 6,
    })).rejects.toThrow("injected late audit failure");

    expect(harness.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE idempotency_key LIKE 'operator-refund:%'",
    ).get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare(
      "SELECT quantity_remaining AS remaining, status FROM evidence_top_up_grant",
    ).get()).toEqual({ remaining: 10, status: "active" });
    expect(harness.sqlite.prepare(
      "SELECT json_extract(metadata_json, '$.refundReconciliationStatus') AS status FROM dodo_webhook_event",
    ).get()).toEqual({ status: "pending" });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get())
      .toEqual({ count: 0 });
  });

  it("does not trust a colliding ledger key with different evidence", async () => {
    const { harness, env } = openEnv();
    harness.sqlite.exec(`
      INSERT INTO evidence_top_up_ledger_entry VALUES (
        'colliding-ledger', 'grant-1', 'owner-1', -5, 'refund', NULL,
        'operator-refund:evt-partial-1:pay-1:v1',
        '{"reason":"partial_provider_refund","providerEventId":"evt-partial-1","evidenceReference":"different-evidence","requestedQuantity":5,"appliedQuantity":5}',
        '2026-07-17T01:30:00.000Z'
      )
    `);

    await expect(reconcilePartialRefundWithAudit(env, {
      ...baseInput,
      decision: "revoke",
      creditQuantityToRevoke: 5,
    })).resolves.toEqual({ reconciled: false, reason: "stale" });
    expect(harness.sqlite.prepare(
      "SELECT json_extract(metadata_json, '$.refundReconciliationStatus') AS status FROM dodo_webhook_event",
    ).get()).toEqual({ status: "pending" });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get())
      .toEqual({ count: 0 });
  });
});
