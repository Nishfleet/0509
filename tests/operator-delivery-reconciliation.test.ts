import { afterEach, describe, expect, it } from "vitest";

import { reconcileBillingEmailAttemptWithAudit } from "~/lib/data/operator-delivery-reconciliation.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

describe("operator billing email reconciliation", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) fixtures.pop()?.close();
  });

  function setup() {
    const harness = createSqliteD1();
    fixtures.push(harness);
    harness.sqlite.exec(`
      CREATE TABLE delivery_attempt (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        watchlist_id TEXT,
        digest_run_id TEXT,
        delivery_target_id TEXT,
        lane TEXT NOT NULL,
        channel TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        webhook_status TEXT NOT NULL,
        target_value TEXT NOT NULL,
        provider_message_id TEXT,
        provider_status_last_seen_at TEXT,
        template_name TEXT,
        event_ids_json TEXT NOT NULL DEFAULT '[]',
        payload_snapshot_json TEXT NOT NULL DEFAULT '{}',
        idempotency_key TEXT,
        error_message TEXT,
        sent_at TEXT,
        failed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
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
      CREATE UNIQUE INDEX idx_test_audit_idempotency
        ON agent_action_audit(user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
    harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, lane, channel, provider, status, webhook_status,
        target_value, payload_snapshot_json, idempotency_key, created_at, updated_at
      ) VALUES (
        'attempt-1', 'customer-1', 'customer', 'email', 'cloudflare_email',
        'pending', 'provider_unknown', 'owner@example.com', '{}',
        'billing-refund:customer-1:event-1',
        '2026-07-15T18:00:00.000Z', '2026-07-15T18:00:00.000Z'
      )
    `).run();
    return harness;
  }

  function input(overrides: Record<string, unknown> = {}) {
    return {
      operatorUserId: "operator-1",
      attemptId: "attempt-1",
      idempotencyKey: "ops-billing-email-reconcile:11111111-1111-4111-8111-111111111111",
      expectedUpdatedAt: "2026-07-15T18:00:00.000Z",
      outcome: "sent" as const,
      classification: "controlled_inbox_receipt" as const,
      evidenceReference: "inbox_receipt_12345",
      observedAt: "2026-07-15T18:01:00.000Z",
      ...overrides,
    };
  }

  it("atomically records provider evidence, terminal state, and a succeeded audit", async () => {
    const harness = setup();
    await expect(
      reconcileBillingEmailAttemptWithAudit({ DB: harness.db } as never, input()),
    ).resolves.toMatchObject({ ok: true, replayed: false, outcome: "sent" });

    const attempt = harness.sqlite.prepare(`
      SELECT status, webhook_status, sent_at, failed_at, payload_snapshot_json
      FROM delivery_attempt WHERE id = 'attempt-1'
    `).get() as Record<string, unknown>;
    expect(attempt).toMatchObject({
      status: "sent",
      webhook_status: "delivered",
      sent_at: "2026-07-15T18:01:00.000Z",
      failed_at: null,
    });
    expect(JSON.parse(String(attempt.payload_snapshot_json))).toMatchObject({
      billingLifecycleProviderEvidence: {
        reference: "inbox_receipt_12345",
        classification: "controlled_inbox_receipt",
        observedAt: "2026-07-15T18:01:00.000Z",
        outcome: "sent",
      },
    });
    expect(
      harness.sqlite.prepare(
        "SELECT action_name, resource_id, status FROM agent_action_audit",
      ).get(),
    ).toMatchObject({
      action_name: "ops.billing_email.reconcile",
      resource_id: "attempt-1",
      status: "succeeded",
    });
  });

  it("replays the exact operator request without mutating the attempt twice", async () => {
    const harness = setup();
    const first = await reconcileBillingEmailAttemptWithAudit({ DB: harness.db } as never, input());
    const second = await reconcileBillingEmailAttemptWithAudit({ DB: harness.db } as never, input());

    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 1 });
  });

  it("lets only one conflicting exact-version reconciliation win", async () => {
    const harness = setup();
    let batchQueue = Promise.resolve<unknown>(undefined);
    const serializedDb = {
      ...harness.db,
      batch(statements: Parameters<typeof harness.db.batch>[0]) {
        const execution = batchQueue.then(() => harness.db.batch(statements));
        batchQueue = execution.catch(() => undefined);
        return execution;
      },
    };
    const [sent, failed] = await Promise.all([
      reconcileBillingEmailAttemptWithAudit({ DB: serializedDb } as never, input()),
      reconcileBillingEmailAttemptWithAudit(
        { DB: serializedDb } as never,
        input({
          idempotencyKey: "ops-billing-email-reconcile:22222222-2222-4222-8222-222222222222",
          outcome: "failed",
          classification: "provider_rejection_log",
          evidenceReference: "provider_reject_12345",
        }),
      ),
    ]);

    expect([sent.ok, failed.ok].filter(Boolean)).toHaveLength(1);
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 1 });
  });

  it("rejects unallowlisted or mismatched evidence before writing", async () => {
    const harness = setup();
    await expect(
      reconcileBillingEmailAttemptWithAudit(
        { DB: harness.db } as never,
        input({ classification: "provider_rejection_log" }),
      ),
    ).resolves.toEqual({ ok: false, reason: "invalid_evidence" });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 0 });
  });
});
