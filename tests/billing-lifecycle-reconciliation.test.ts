import { afterEach, describe, expect, it } from "vitest";

import {
  listBillingLifecycleReconciliationCandidates,
  reconcileBillingLifecycleEmailAttempt,
  type BillingLifecycleEmailReconciliationInput,
} from "~/lib/data/billing-lifecycle-reconciliation.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

type Harness = ReturnType<typeof createSqliteD1>;

const fixtures: Harness[] = [];
const env = (harness: Harness) => ({ DB: harness.db }) as never;

function serializedEnv(harness: Harness) {
  let tail = Promise.resolve();
  const db = {
    ...harness.db,
    batch(statements: Parameters<typeof harness.db.batch>[0]) {
      const next = tail.then(() => harness.db.batch(statements));
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  return { DB: db } as never;
}

const baseAttempt = {
  id: "attempt-1",
  userId: "operator-1",
  watchlistId: null,
  digestRunId: null,
  deliveryTargetId: null,
  lane: "customer",
  channel: "email",
  provider: "cloudflare_email",
  status: "pending",
  webhookStatus: "provider_unknown",
  targetValue: "owner@example.com",
  providerMessageId: null,
  providerStatusLastSeenAt: "2026-07-15T10:00:00.000Z",
  templateName: "billing_payment_issue",
  idempotencyKey: "billing-payment-issue:user-1:2026-07-15",
  errorMessage: null,
  sentAt: null,
  failedAt: null,
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z",
} as const;

const input = (
  overrides: Partial<BillingLifecycleEmailReconciliationInput> = {},
): BillingLifecycleEmailReconciliationInput => ({
  operatorUserId: "operator-1",
  attemptId: baseAttempt.id,
  expectedUpdatedAt: baseAttempt.updatedAt,
  outcome: "failed",
  evidenceClassification: "provider_rejection_log",
  evidenceReference: "https://dash.cloudflare.com/evidence/evt-123",
  observedAt: "2026-07-15T10:04:00.000Z",
  providerMessageId: null,
  reconciledAt: "2026-07-15T10:05:00.000Z",
  ...overrides,
});

function migrate(harness: Harness) {
  harness.sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE delivery_attempt (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      digest_run_id TEXT,
      delivery_target_id TEXT,
      lane TEXT NOT NULL CHECK (lane IN ('internal', 'customer')),
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
      idempotency_key TEXT UNIQUE,
      error_message TEXT,
      sent_at TEXT,
      failed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_action_audit (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id),
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
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, idempotency_key)
    );
  `);
  harness.sqlite.exec("INSERT INTO user (id) VALUES ('operator-1')");
  seedAttempt(harness);
}

function seedAttempt(harness: Harness, overrides: Record<string, unknown> = {}) {
  const row = { ...baseAttempt, ...overrides };
  harness.sqlite
    .prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, watchlist_id, digest_run_id, delivery_target_id, lane,
        channel, provider, status, webhook_status, target_value,
        provider_message_id, provider_status_last_seen_at, template_name,
        idempotency_key, error_message, sent_at, failed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      row.id,
      row.userId,
      row.watchlistId,
      row.digestRunId,
      row.deliveryTargetId,
      row.lane,
      row.channel,
      row.provider,
      row.status,
      row.webhookStatus,
      row.targetValue,
      row.providerMessageId,
      row.providerStatusLastSeenAt,
      row.templateName,
      row.idempotencyKey,
      row.errorMessage,
      row.sentAt,
      row.failedAt,
      row.createdAt,
      row.updatedAt,
    );
}

function readAttempt(harness: Harness) {
  return harness.sqlite.prepare("SELECT * FROM delivery_attempt WHERE id = ?").get(baseAttempt.id) as Record<
    string,
    unknown
  >;
}

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.close();
});

describe("billing lifecycle reconciliation persistence", () => {
  it("atomically marks failed evidence and writes a safe audit", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    const result = await reconcileBillingLifecycleEmailAttempt(env(harness), input());

    expect(result).toMatchObject({
      reconciled: true,
      auditId: expect.any(String),
      idempotencyKey: `billing-lifecycle-reconcile:${baseAttempt.id}:${baseAttempt.updatedAt}`,
    });
    expect(readAttempt(harness)).toMatchObject({
      status: "failed",
      webhook_status: "failed",
      error_message: "Provider evidence confirmed the billing lifecycle email was not accepted.",
      failed_at: "2026-07-15T10:04:00.000Z",
      updated_at: "2026-07-15T10:05:00.000Z",
    });
    const audit = harness.sqlite.prepare("SELECT * FROM agent_action_audit").get() as Record<
      string,
      unknown
    >;
    expect(audit).toMatchObject({
      user_id: "operator-1",
      action_name: "billing.lifecycle_email.reconcile",
      resource_type: "delivery_attempt",
      resource_id: baseAttempt.id,
      status: "succeeded",
    });
    expect(audit.metadata_json).toContain("evidenceReference");
    expect(audit.metadata_json).not.toContain("owner@example.com");
    expect(audit.metadata_json).not.toContain("Provider evidence confirmed");
  });

  it("marks sent evidence delivered and preserves a provider message id", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    const result = await reconcileBillingLifecycleEmailAttempt(
      env(harness),
      input({
        outcome: "sent",
        evidenceClassification: "provider_delivery_confirmation",
        providerMessageId: "cf-message-123",
      }),
    );

    expect(result.reconciled).toBe(true);
    expect(readAttempt(harness)).toMatchObject({
      status: "sent",
      webhook_status: "delivered",
      provider_message_id: "cf-message-123",
      error_message: null,
      sent_at: "2026-07-15T10:04:00.000Z",
    });
  });

  it("records provider acceptance without manufacturing delivery truth", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    const result = await reconcileBillingLifecycleEmailAttempt(
      env(harness),
      input({
        outcome: "sent",
        evidenceClassification: "provider_acceptance_log",
        providerMessageId: "cf-message-accepted",
      }),
    );

    expect(result.reconciled).toBe(true);
    expect(readAttempt(harness)).toMatchObject({
      status: "sent",
      webhook_status: "provider_unknown",
      provider_message_id: "cf-message-accepted",
      error_message: null,
      sent_at: "2026-07-15T10:04:00.000Z",
    });
    const audit = harness.sqlite.prepare(
      "SELECT result_json FROM agent_action_audit WHERE resource_id = ?",
    ).get(baseAttempt.id) as { result_json: string };
    expect(JSON.parse(audit.result_json)).toMatchObject({
      deliveryAttemptStatus: "sent",
      webhookStatus: "provider_unknown",
    });

    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({
          expectedUpdatedAt: "2026-07-15T10:05:00.000Z",
          outcome: "sent",
          evidenceClassification: "provider_delivery_confirmation",
          evidenceReference: "https://dash.cloudflare.com/evidence/evt-456",
          observedAt: "2026-07-15T10:06:00.000Z",
          reconciledAt: "2026-07-15T10:07:00.000Z",
        }),
      ),
    ).resolves.toMatchObject({ reconciled: true });
    expect(readAttempt(harness)).toMatchObject({
      status: "sent",
      webhook_status: "delivered",
      sent_at: "2026-07-15T10:04:00.000Z",
    });
  });

  it("requires bounded evidence and rejects invalid outcome fields", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ evidenceReference: "   " }),
      ),
    ).rejects.toThrow("evidenceReference");
    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ evidenceReference: "<script>alert(1)</script>" }),
      ),
    ).rejects.toThrow("evidenceReference");
    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ evidenceReference: "x".repeat(513) }),
      ),
    ).rejects.toThrow("evidenceReference");
    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ providerMessageId: "x".repeat(256) }),
      ),
    ).rejects.toThrow("providerMessageId");
    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ observedAt: "not-a-timestamp" }),
      ),
    ).rejects.toThrow("observedAt");
    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({
          outcome: "sent",
          evidenceClassification: "provider_rejection_log",
        }),
      ),
    ).rejects.toThrow("evidenceClassification");
    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ outcome: "pending" as never }),
      ),
    ).rejects.toThrow("outcome");
  });

  it("allows only customer lifecycle rows with exact key/template mappings", async () => {
    const cases = [
      { lane: "customer", idempotencyKey: "instant:watch-1:email:batch-1", templateName: "instant_alert" },
      { lane: "internal", idempotencyKey: baseAttempt.idempotencyKey, templateName: baseAttempt.templateName },
      { lane: "customer", provider: "other_email", idempotencyKey: baseAttempt.idempotencyKey, templateName: baseAttempt.templateName },
      { lane: "customer", idempotencyKey: "billing-refund:user-1:event-1", templateName: "billing_payment_issue" },
      { lane: "customer", idempotencyKey: "billing-cancellation:user-1:event-1", templateName: "billing_refund_revoked" },
      { lane: "customer", idempotencyKey: "billing-unknown:user-1:event-1", templateName: "billing_payment_issue" },
    ];

    for (const [index, row] of cases.entries()) {
      const harness = createSqliteD1();
      fixtures.push(harness);
      migrate(harness);
      const attemptId = `attempt-${index + 2}`;
      seedAttempt(harness, {
        id: attemptId,
        lane: row.lane,
        provider: "provider" in row ? row.provider : baseAttempt.provider,
        idempotencyKey: `${row.idempotencyKey}:case-${index}`,
        templateName: row.templateName,
      });
      const result = await reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ attemptId, expectedUpdatedAt: baseAttempt.updatedAt }),
      );
      expect(result.reconciled).toBe(false);
      expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get()).toEqual({ count: 0 });
    }
  });

  it("lists only safe provider-unknown billing lifecycle candidates", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    seedAttempt(harness, {
      id: "ordinary-customer-attempt",
      idempotencyKey: "instant:watch-1:email:batch-1",
      templateName: "instant_alert",
    });
    seedAttempt(harness, {
      id: "wrong-provider-attempt",
      provider: "other_email",
      idempotencyKey: "billing-refund:user-1:event-2",
      templateName: "billing_refund_revoked",
    });

    const candidates = await listBillingLifecycleReconciliationCandidates(env(harness));

    expect(candidates).toEqual([
      {
        attemptId: baseAttempt.id,
        lifecycleKind: "payment_issue",
        status: "pending",
        providerStatusLastSeenAt: baseAttempt.providerStatusLastSeenAt,
        createdAt: baseAttempt.createdAt,
        updatedAt: baseAttempt.updatedAt,
      },
    ]);
    expect(JSON.stringify(candidates)).not.toContain("owner@example.com");
  });

  it("prioritizes pending billing attempts ahead of newer accepted sends", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    for (let index = 0; index < 20; index += 1) {
      const timestamp = `2026-07-16T10:00:${String(index).padStart(2, "0")}.000Z`;
      seedAttempt(harness, {
        id: `accepted-attempt-${index}`,
        status: "sent",
        sentAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        idempotencyKey: `billing-payment-issue:user-${index + 2}:2026-07-16`,
      });
    }

    const candidates = await listBillingLifecycleReconciliationCandidates(env(harness));

    expect(candidates).toHaveLength(20);
    expect(candidates[0]).toMatchObject({
      attemptId: baseAttempt.id,
      status: "pending",
    });
    expect(candidates.filter((candidate) => candidate.status === "sent")).toHaveLength(19);
  });

  it("lists and settles an accepted billing email whose final delivery is unconfirmed", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'sent',
          sent_at = '2026-07-15T10:00:30.000Z'
      WHERE id = ?
    `).run(baseAttempt.id);

    await expect(
      listBillingLifecycleReconciliationCandidates(env(harness)),
    ).resolves.toMatchObject([{ attemptId: baseAttempt.id }]);
    await expect(
      reconcileBillingLifecycleEmailAttempt(env(harness), input()),
    ).resolves.toMatchObject({ reconciled: true });
    expect(readAttempt(harness)).toMatchObject({
      status: "failed",
      webhook_status: "failed",
      sent_at: "2026-07-15T10:00:30.000Z",
      failed_at: "2026-07-15T10:04:00.000Z",
    });
  });

  it("rejects evidence that predates provider acceptance", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'sent',
          sent_at = '2026-07-15T10:00:30.000Z'
      WHERE id = ?
    `).run(baseAttempt.id);

    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ observedAt: "2026-07-15T09:59:59.000Z" }),
      ),
    ).resolves.toMatchObject({ reconciled: false, auditId: null });
    expect(readAttempt(harness)).toMatchObject({
      status: "sent",
      webhook_status: "provider_unknown",
      sent_at: "2026-07-15T10:00:30.000Z",
    });
  });

  it("rejects evidence outside the attempt lifecycle or too far in the future", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);

    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ observedAt: "2026-07-15T09:59:59.000Z" }),
      ),
    ).resolves.toMatchObject({ reconciled: false, auditId: null });
    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({ observedAt: "2026-07-15T10:10:01.000Z" }),
      ),
    ).resolves.toMatchObject({ reconciled: false, auditId: null });
  });

  it("requires delivery evidence before finalizing an already-accepted email", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'sent',
          sent_at = '2026-07-15T10:00:30.000Z'
      WHERE id = ?
    `).run(baseAttempt.id);

    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({
          outcome: "sent",
          evidenceClassification: "provider_acceptance_log",
        }),
      ),
    ).resolves.toMatchObject({ reconciled: false, auditId: null });
    await expect(
      reconcileBillingLifecycleEmailAttempt(
        env(harness),
        input({
          outcome: "sent",
          evidenceClassification: "provider_delivery_confirmation",
        }),
      ),
    ).resolves.toMatchObject({ reconciled: true });
  });

  it("loses stale and delayed-provider races without creating an audit", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    harness.sqlite
      .prepare("UPDATE delivery_attempt SET status = 'sent', webhook_status = 'delivered', updated_at = ? WHERE id = ?")
      .run("2026-07-15T10:06:00.000Z", baseAttempt.id);

    const result = await reconcileBillingLifecycleEmailAttempt(env(harness), input());

    expect(result).toMatchObject({ reconciled: false, auditId: null });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get()).toEqual({ count: 0 });
  });

  it("has one winner for concurrent reconciliation attempts", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    const concurrentEnv = serializedEnv(harness);

    const results = await Promise.all([
      reconcileBillingLifecycleEmailAttempt(concurrentEnv, input()),
      reconcileBillingLifecycleEmailAttempt(concurrentEnv, input()),
    ]);

    expect(results.filter((result) => result.reconciled)).toHaveLength(1);
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get()).toEqual({ count: 1 });
    expect(readAttempt(harness)).toMatchObject({ status: "failed", webhook_status: "failed" });
  });

  it("rolls back the delivery transition when audit insertion fails", async () => {
    const harness = createSqliteD1();
    fixtures.push(harness);
    migrate(harness);
    harness.sqlite.exec(`
      CREATE TRIGGER reject_reconciliation_audit
      BEFORE INSERT ON agent_action_audit
      BEGIN
        SELECT RAISE(ABORT, 'audit unavailable');
      END;
    `);

    await expect(
      reconcileBillingLifecycleEmailAttempt(env(harness), input()),
    ).rejects.toThrow("audit unavailable");
    expect(readAttempt(harness)).toMatchObject({
      status: "pending",
      webhook_status: "provider_unknown",
      updated_at: baseAttempt.updatedAt,
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get()).toEqual({ count: 0 });
  });
});
