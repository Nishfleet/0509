import { afterEach, describe, expect, it } from "vitest";

import * as operatorReconciliation from "~/lib/data/operator-delivery-reconciliation.server";
import {
  listOutstandingDigestProviderUnknownAttempts,
} from "~/lib/data/delivery-records-attempts.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

const {
  reconcileBillingEmailAttemptWithAudit,
  reconcileDigestEmailAttemptWithAudit,
} = operatorReconciliation;

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

  it.each([
    ["sent", "controlled_inbox_receipt", "inbox_receipt_failed_unknown", "sent", "delivered"],
    ["failed", "provider_rejection_log", "provider_reject_failed_unknown", "failed", "failed"],
  ] as const)(
    "reconciles a listed failed/provider_unknown attempt as %s",
    async (outcome, classification, evidenceReference, expectedStatus, expectedWebhookStatus) => {
      const harness = setup();
      harness.sqlite
        .prepare(
          `
            UPDATE delivery_attempt
            SET status = 'failed',
                provider_status_last_seen_at = '2026-07-15T18:00:30.000Z'
            WHERE id = 'attempt-1'
          `,
        )
        .run();

      await expect(
        reconcileBillingEmailAttemptWithAudit(
          { DB: harness.db } as never,
          input({ outcome, classification, evidenceReference }),
        ),
      ).resolves.toMatchObject({ ok: true, replayed: false, outcome });

      expect(
        harness.sqlite
          .prepare(
            `
              SELECT status, webhook_status, payload_snapshot_json
              FROM delivery_attempt
              WHERE id = 'attempt-1'
            `,
          )
          .get(),
      ).toMatchObject({
        status: expectedStatus,
        webhook_status: expectedWebhookStatus,
      });
      const payload = harness.sqlite
        .prepare("SELECT payload_snapshot_json FROM delivery_attempt WHERE id = 'attempt-1'")
        .get() as { payload_snapshot_json: string };
      expect(JSON.parse(payload.payload_snapshot_json)).toMatchObject({
        billingLifecycleProviderEvidence: {
          reference: evidenceReference,
          classification,
          outcome,
        },
      });
    },
  );

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

describe("operator digest email reconciliation", () => {
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
      CREATE UNIQUE INDEX idx_test_digest_audit_idempotency
        ON agent_action_audit(user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE TABLE digest_delivery (
        id TEXT PRIMARY KEY NOT NULL,
        digest_run_id TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        external_message_id TEXT,
        error_message TEXT,
        delivered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, digest_run_id, delivery_target_id, lane, channel, provider,
        status, webhook_status, target_value, provider_status_last_seen_at,
        payload_snapshot_json, idempotency_key, error_message, failed_at,
        created_at, updated_at
      ) VALUES (
        'digest-attempt-1', 'customer-1', 'digest-1', 'email-target-1',
        'customer', 'email', 'cloudflare_email', 'failed', 'provider_unknown',
        'owner@example.com', '2026-07-15T18:00:30.000Z', '{}',
        'digest:digest-1:customer:email:owner@example.com',
        'Cloudflare Email send outcome is unknown after provider exception.',
        '2026-07-15T18:00:30.000Z',
        '2026-07-15T18:00:00.000Z', '2026-07-15T18:00:30.000Z'
      )
    `).run();
    harness.sqlite.prepare(`
      INSERT INTO digest_delivery (
        id, digest_run_id, provider, status, recipient_email, external_message_id,
        error_message, delivered_at, created_at, updated_at
      ) VALUES (
        'digest-delivery-1', 'digest-1', 'cloudflare_email', 'failed',
        'owner@example.com', NULL,
        'Cloudflare Email send outcome is unknown after provider exception.',
        NULL, '2026-07-15T18:00:00.000Z', '2026-07-15T18:00:30.000Z'
      )
    `).run();
    return harness;
  }

  function input(overrides: Record<string, unknown> = {}) {
    return {
      operatorUserId: "operator-1",
      attemptId: "digest-attempt-1",
      idempotencyKey: "ops-digest-email-reconcile:11111111-1111-4111-8111-111111111111",
      expectedUpdatedAt: "2026-07-15T18:00:30.000Z",
      outcome: "sent" as const,
      classification: "controlled_inbox_receipt" as const,
      evidenceReference: "digest_inbox_receipt_12345",
      observedAt: "2026-07-15T18:01:00.000Z",
      ...overrides,
    };
  }

  it("atomically marks provider-accepted digest email sent without resending it", async () => {
    const harness = setup();

    await expect(
      reconcileDigestEmailAttemptWithAudit({ DB: harness.db } as never, input()),
    ).resolves.toMatchObject({ ok: true, replayed: false, outcome: "sent" });

    const attempt = harness.sqlite.prepare(`
      SELECT status, webhook_status, sent_at, failed_at, payload_snapshot_json
      FROM delivery_attempt WHERE id = 'digest-attempt-1'
    `).get() as Record<string, unknown>;
    expect(attempt).toMatchObject({
      status: "sent",
      webhook_status: "delivered",
      sent_at: "2026-07-15T18:01:00.000Z",
      failed_at: null,
    });
    expect(JSON.parse(String(attempt.payload_snapshot_json))).toMatchObject({
      digestProviderEvidence: {
        reference: "digest_inbox_receipt_12345",
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
      action_name: "ops.digest_email.reconcile",
      resource_id: "digest-attempt-1",
      status: "succeeded",
    });
    expect(
      harness.sqlite.prepare(`
        SELECT status, error_message, delivered_at
        FROM digest_delivery WHERE digest_run_id = 'digest-1'
      `).get(),
    ).toMatchObject({
      status: "sent",
      error_message: null,
      delivered_at: "2026-07-15T18:01:00.000Z",
    });
  });

  it("reconciles an accepted digest email whose final delivery remained unknown", async () => {
    const harness = setup();
    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'sent',
          error_message = NULL,
          sent_at = '2026-07-15T18:00:30.000Z',
          failed_at = NULL
      WHERE id = 'digest-attempt-1'
    `).run();

    await expect(
      reconcileDigestEmailAttemptWithAudit({ DB: harness.db } as never, input()),
    ).resolves.toMatchObject({ ok: true, replayed: false, outcome: "sent" });

    expect(
      harness.sqlite.prepare(`
        SELECT status, webhook_status, sent_at
        FROM delivery_attempt
        WHERE id = 'digest-attempt-1'
      `).get(),
    ).toMatchObject({
      status: "sent",
      webhook_status: "delivered",
      sent_at: "2026-07-15T18:01:00.000Z",
    });
  });

  it("lists only digest email attempts whose provider outcome still needs reconciliation", async () => {
    const harness = setup();
    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'sent',
          error_message = NULL,
          sent_at = '2026-07-15T18:00:30.000Z',
          failed_at = NULL
      WHERE id = 'digest-attempt-1'
    `).run();
    harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, lane, channel, provider, status, webhook_status,
        target_value, provider_status_last_seen_at, payload_snapshot_json,
        idempotency_key, created_at, updated_at
      ) VALUES (
        'billing-attempt-1', 'customer-1', 'customer', 'email', 'cloudflare_email',
        'failed', 'provider_unknown', 'owner@example.com',
        '2026-07-15T18:00:30.000Z', '{}',
        'billing-refund:customer-1:event-1',
        '2026-07-15T18:00:00.000Z', '2026-07-15T18:00:30.000Z'
      )
    `).run();

    const attempts = await listOutstandingDigestProviderUnknownAttempts(
      { DB: harness.db } as never,
      { limit: 10 },
    );

    expect(attempts.map((attempt) => attempt.id)).toEqual(["digest-attempt-1"]);
  });

  it("restores the customer-facing digest aggregate when an interrupted worker never wrote it", async () => {
    const harness = setup();
    harness.sqlite.prepare("DELETE FROM digest_delivery WHERE digest_run_id = 'digest-1'").run();

    await expect(
      reconcileDigestEmailAttemptWithAudit({ DB: harness.db } as never, input()),
    ).resolves.toMatchObject({ ok: true, replayed: false, outcome: "sent" });

    expect(
      harness.sqlite.prepare(`
        SELECT digest_run_id, status, recipient_email, delivered_at
        FROM digest_delivery WHERE digest_run_id = 'digest-1'
      `).get(),
    ).toMatchObject({
      digest_run_id: "digest-1",
      status: "sent",
      recipient_email: "owner@example.com",
      delivered_at: "2026-07-15T18:01:00.000Z",
    });
  });

  it("marks a provider-confirmed rejection safely retryable and replays the same operator request", async () => {
    const harness = setup();
    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'sent',
          error_message = NULL,
          sent_at = '2026-07-15T18:00:30.000Z',
          failed_at = NULL
      WHERE id = 'digest-attempt-1'
    `).run();
    harness.sqlite.prepare(`
      UPDATE digest_delivery
      SET status = 'sent',
          error_message = NULL,
          delivered_at = '2026-07-15T18:00:30.000Z'
      WHERE digest_run_id = 'digest-1'
    `).run();
    const reconciliation = input({
      outcome: "failed",
      classification: "provider_rejection_log",
      evidenceReference: "digest_provider_reject_12345",
    });

    const first = await reconcileDigestEmailAttemptWithAudit(
      { DB: harness.db } as never,
      reconciliation,
    );
    const replay = await reconcileDigestEmailAttemptWithAudit(
      { DB: harness.db } as never,
      reconciliation,
    );

    expect(first).toMatchObject({ ok: true, replayed: false, outcome: "failed" });
    expect(replay).toMatchObject({ ok: true, replayed: true, outcome: "failed" });
    expect(
      harness.sqlite.prepare(`
        SELECT status, webhook_status, provider_status_last_seen_at, sent_at
        FROM delivery_attempt WHERE id = 'digest-attempt-1'
      `).get(),
    ).toMatchObject({
      status: "failed",
      webhook_status: "failed",
      provider_status_last_seen_at: "2026-07-15T18:01:00.000Z",
      sent_at: "2026-07-15T18:00:30.000Z",
    });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 1 });
    expect(
      harness.sqlite.prepare(`
        SELECT status, error_message, delivered_at
        FROM digest_delivery WHERE digest_run_id = 'digest-1'
      `).get(),
    ).toMatchObject({
      status: "failed",
      error_message: "Provider reconciliation confirmed this delivery was not accepted.",
      delivered_at: null,
    });
  });

  it("preserves a sent digest aggregate when a different recipient attempt succeeded", async () => {
    const harness = setup();
    harness.sqlite.prepare(`
      UPDATE delivery_attempt
      SET status = 'sent',
          error_message = NULL,
          sent_at = '2026-07-15T18:00:30.000Z',
          failed_at = NULL
      WHERE id = 'digest-attempt-1'
    `).run();
    harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, digest_run_id, delivery_target_id, lane, channel, provider,
        status, webhook_status, target_value, provider_status_last_seen_at,
        payload_snapshot_json, idempotency_key, error_message, sent_at,
        created_at, updated_at
      ) VALUES (
        'digest-attempt-2', 'customer-1', 'digest-1', 'email-target-2',
        'customer', 'email', 'cloudflare_email', 'sent', 'provider_unknown',
        'other@example.com', '2026-07-15T18:00:30.000Z', '{}',
        'digest:digest-1:customer:email:other@example.com',
        NULL, '2026-07-15T18:00:30.000Z',
        '2026-07-15T18:00:00.000Z', '2026-07-15T18:00:30.000Z'
      )
    `).run();
    harness.sqlite.prepare(`
      UPDATE digest_delivery
      SET status = 'sent',
          recipient_email = 'other@example.com',
          error_message = NULL,
          delivered_at = '2026-07-15T18:00:30.000Z'
      WHERE digest_run_id = 'digest-1'
    `).run();

    await expect(
      reconcileDigestEmailAttemptWithAudit(
        { DB: harness.db } as never,
        input({
          outcome: "failed",
          classification: "provider_rejection_log",
          evidenceReference: "digest_provider_reject_12345",
        }),
      ),
    ).resolves.toMatchObject({ ok: true, replayed: false, outcome: "failed" });

    expect(
      harness.sqlite.prepare(`
        SELECT status, recipient_email, error_message, delivered_at
        FROM digest_delivery WHERE digest_run_id = 'digest-1'
      `).get(),
    ).toMatchObject({
      status: "sent",
      recipient_email: "other@example.com",
      error_message: null,
      delivered_at: "2026-07-15T18:00:30.000Z",
    });
  });

  it("lets only one conflicting digest reconciliation update the attempt, aggregate, and audit", async () => {
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
      reconcileDigestEmailAttemptWithAudit({ DB: serializedDb } as never, input()),
      reconcileDigestEmailAttemptWithAudit(
        { DB: serializedDb } as never,
        input({
          idempotencyKey: "ops-digest-email-reconcile:22222222-2222-4222-8222-222222222222",
          outcome: "failed",
          classification: "provider_rejection_log",
          evidenceReference: "digest_provider_reject_12345",
        }),
      ),
    ]);

    expect([sent.ok, failed.ok].filter(Boolean)).toHaveLength(1);
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 1 });
    const attempt = harness.sqlite.prepare(`
      SELECT status FROM delivery_attempt WHERE id = 'digest-attempt-1'
    `).get() as { status: string };
    expect(
      harness.sqlite.prepare(`
        SELECT status FROM digest_delivery WHERE digest_run_id = 'digest-1'
      `).get(),
    ).toMatchObject({ status: attempt.status });
  });
});

describe("operator support-alert reconciliation", () => {
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
      CREATE UNIQUE INDEX idx_test_support_alert_audit_idempotency
        ON agent_action_audit(user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
    harness.sqlite.prepare(`
      INSERT INTO delivery_attempt (
        id, user_id, lane, channel, provider, status, webhook_status,
        target_value, provider_status_last_seen_at, payload_snapshot_json,
        idempotency_key, error_message, failed_at, created_at, updated_at
      ) VALUES (
        'support-attempt-1', 'operator-owner-1', 'internal', 'email',
        'cloudflare_email', 'failed', 'provider_unknown', 'operator@example.test',
        '2026-07-15T18:00:30.000Z',
        '{"kind":"support_case_operator_alert","caseId":"case-1"}',
        'support-case:case-1',
        'Cloudflare Email send outcome is unknown after provider exception.',
        '2026-07-15T18:00:30.000Z',
        '2026-07-15T18:00:00.000Z', '2026-07-15T18:00:30.000Z'
      )
    `).run();
    return harness;
  }

  function input(overrides: Record<string, unknown> = {}) {
    return {
      operatorUserId: "operator-1",
      attemptId: "support-attempt-1",
      idempotencyKey: "ops-support-alert-reconcile:11111111-1111-4111-8111-111111111111",
      expectedUpdatedAt: "2026-07-15T18:00:30.000Z",
      outcome: "failed" as const,
      classification: "provider_rejection_log" as const,
      evidenceReference: "support_provider_reject_12345",
      observedAt: "2026-07-15T18:01:00.000Z",
      ...overrides,
    };
  }

  it("rejects timezone-less provider evidence instead of shifting the audit instant", async () => {
    const reconcileSupportAlertAttemptWithAudit = (
      operatorReconciliation as Record<string, unknown>
    ).reconcileSupportAlertAttemptWithAudit;
    expect(typeof reconcileSupportAlertAttemptWithAudit).toBe("function");
    if (typeof reconcileSupportAlertAttemptWithAudit !== "function") return;
    const harness = setup();

    await expect(
      reconcileSupportAlertAttemptWithAudit(
        { DB: harness.db },
        input({ observedAt: "2026-07-15T23:31:00" }),
      ),
    ).resolves.toEqual({ ok: false, reason: "invalid_evidence" });

    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 0 });
  });

  it("records a confirmed rejection as safely retryable without sending", async () => {
    const reconcileSupportAlertAttemptWithAudit = (
      operatorReconciliation as Record<string, unknown>
    ).reconcileSupportAlertAttemptWithAudit;
    expect(typeof reconcileSupportAlertAttemptWithAudit).toBe("function");
    if (typeof reconcileSupportAlertAttemptWithAudit !== "function") return;
    const harness = setup();

    await expect(
      reconcileSupportAlertAttemptWithAudit({ DB: harness.db }, input()),
    ).resolves.toMatchObject({ ok: true, replayed: false, outcome: "failed" });

    expect(
      harness.sqlite.prepare(`
        SELECT status, webhook_status, payload_snapshot_json
        FROM delivery_attempt WHERE id = 'support-attempt-1'
      `).get(),
    ).toMatchObject({ status: "failed", webhook_status: "failed" });
    const payload = harness.sqlite.prepare(`
      SELECT payload_snapshot_json FROM delivery_attempt WHERE id = 'support-attempt-1'
    `).get() as { payload_snapshot_json: string };
    expect(JSON.parse(payload.payload_snapshot_json)).toMatchObject({
      supportAlertProviderEvidence: {
        outcome: "failed",
        classification: "provider_rejection_log",
        reference: "support_provider_reject_12345",
      },
    });
    expect(
      harness.sqlite.prepare("SELECT action_name FROM agent_action_audit").get(),
    ).toMatchObject({ action_name: "ops.support_alert.reconcile" });
  });

  it("records confirmed provider acceptance as sent and replays exactly once", async () => {
    const reconcileSupportAlertAttemptWithAudit = (
      operatorReconciliation as Record<string, unknown>
    ).reconcileSupportAlertAttemptWithAudit;
    expect(typeof reconcileSupportAlertAttemptWithAudit).toBe("function");
    if (typeof reconcileSupportAlertAttemptWithAudit !== "function") return;
    const harness = setup();
    const reconciliation = input({
      outcome: "sent",
      classification: "controlled_inbox_receipt",
      evidenceReference: "support_inbox_receipt_12345",
    });

    const first = await reconcileSupportAlertAttemptWithAudit(
      { DB: harness.db },
      reconciliation,
    );
    const replay = await reconcileSupportAlertAttemptWithAudit(
      { DB: harness.db },
      reconciliation,
    );

    expect(first).toMatchObject({ ok: true, replayed: false, outcome: "sent" });
    expect(replay).toMatchObject({ ok: true, replayed: true, outcome: "sent" });
    expect(
      harness.sqlite.prepare(`
        SELECT status, webhook_status, sent_at
        FROM delivery_attempt WHERE id = 'support-attempt-1'
      `).get(),
    ).toMatchObject({
      status: "sent",
      webhook_status: "delivered",
      sent_at: "2026-07-15T18:01:00.000Z",
    });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toMatchObject({ count: 1 });
  });
});
