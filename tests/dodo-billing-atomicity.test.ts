import { afterEach, describe, expect, it } from "vitest";

import {
  applyDodoPlanGrantWithWatchlistReconcile,
  applyDodoPlanRevokeWithWatchlistReconcile,
  applyDodoRefundWithWatchlistReconcile,
  beginDodoWebhookEventProcessing,
  buildCapacitySkipIdempotencyKey,
  failDodoWebhookEventProcessing,
  recordWatchlistCapacitySkip,
} from "~/lib/data.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

function seedBillingSchema(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
  sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL
    );
    INSERT INTO user (id) VALUES ('user-1');

    CREATE TABLE user_plan (
      user_id TEXT PRIMARY KEY NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      dodo_payment_id TEXT,
      dodo_product_id TEXT,
      dodo_subscription_id TEXT,
      dodo_customer_id TEXT,
      dodo_next_billing_at TEXT,
      dodo_status TEXT,
      plan_updated_at TEXT
    );

    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_fingerprint TEXT NOT NULL,
      target_label TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      paused_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE watchlist_run (
      id TEXT PRIMARY KEY NOT NULL,
      watchlist_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      page_budget INTEGER NOT NULL DEFAULT 0,
      pages_scanned INTEGER NOT NULL DEFAULT 0,
      baseline_from_run_id TEXT,
      summary_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_watchlist_run_idempotency_key
      ON watchlist_run(idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE TABLE dodo_webhook_event (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      user_id TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      payload_timestamp TEXT,
      processed_at TEXT,
      outcome TEXT NOT NULL DEFAULT 'received',
      processing_started_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE proof_usage_credit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_payment_id TEXT NOT NULL UNIQUE,
      provider_product_id TEXT NOT NULL,
      bundle_slug TEXT NOT NULL,
      credits INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      granted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE web_mention_target (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    INSERT INTO watchlist (
      id, user_id, name, target_type, target_id, target_fingerprint, target_label,
      is_active, paused_reason, created_at, updated_at
    ) VALUES
      ('wl-1', 'user-1', 'One', 'saved_query', 'sq-1', 'fp-1', 'One', 1, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('wl-2', 'user-1', 'Two', 'saved_query', 'sq-2', 'fp-2', 'Two', 1, NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('wl-3', 'user-1', 'Three', 'saved_query', 'sq-3', 'fp-3', 'Three', 0, 'plan_limit', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z');
  `);
}

describe("Dodo billing atomicity (sqlite)", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) {
      fixtures.pop()?.close();
    }
  });

  function openEnv() {
    const harness = createSqliteD1();
    fixtures.push(harness);
    seedBillingSchema(harness.sqlite);
    return { DB: harness.db } as never;
  }

  it("commits grant, watchlist reconcile, and processed ledger in one batch", async () => {
    const env = openEnv();
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-grant-1",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });

    await applyDodoPlanGrantWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        plan: "scout",
        providerPaymentId: "pay-1",
        providerProductId: "prod_scout",
        providerSubscriptionId: "sub-1",
        providerCustomerId: "cus-1",
        status: "succeeded",
        grantedAt: "2026-06-10T00:00:00.000Z",
      },
      3,
      {
        eventId: "evt-grant-1",
        outcome: "processed",
        metadata: { action: "plan_grant" },
      },
    );

    const plan = fixtures[0]!.sqlite
      .prepare("SELECT plan FROM user_plan WHERE user_id = ?")
      .get("user-1") as { plan: string };
    const activeCount = fixtures[0]!.sqlite
      .prepare("SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ? AND is_active = 1")
      .get("user-1") as { count: number };
    const ledger = fixtures[0]!.sqlite
      .prepare("SELECT outcome, processed_at FROM dodo_webhook_event WHERE event_id = ?")
      .get("evt-grant-1") as { outcome: string; processed_at: string | null };

    expect(plan.plan).toBe("scout");
    expect(activeCount.count).toBe(3);
    expect(ledger.outcome).toBe("processed");
    expect(ledger.processed_at).toEqual(expect.any(String));
  });

  it("rolls back grant mutations when a watchlist reconcile statement fails", async () => {
    const env = openEnv();
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-grant-rollback",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });

    const harness = fixtures[0]!;
    const originalPrepare = harness.sqlite.prepare.bind(harness.sqlite);
    harness.sqlite.prepare = (sql: string) => {
      const statement = originalPrepare(sql);
      const originalRun = statement.run.bind(statement);
      statement.run = (...args: never[]) => {
        if (sql.includes("UPDATE watchlist") && sql.includes("paused_reason = 'plan_limit'")) {
          throw new Error("watchlist reconcile failed");
        }
        return originalRun(...args);
      };
      return statement;
    };

    await expect(
      applyDodoPlanGrantWithWatchlistReconcile(
        env,
        {
          userId: "user-1",
          plan: "starter",
          providerPaymentId: "pay-rollback",
          providerProductId: "prod_starter",
          providerSubscriptionId: null,
          providerCustomerId: null,
          status: "succeeded",
          grantedAt: "2026-06-10T00:00:00.000Z",
        },
        10,
        {
          eventId: "evt-grant-rollback",
          outcome: "processed",
          metadata: {},
        },
      ),
    ).rejects.toThrow("watchlist reconcile failed");

    const plan = harness.sqlite
      .prepare("SELECT plan FROM user_plan WHERE user_id = ?")
      .get("user-1");
    const ledger = harness.sqlite
      .prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
      .get("evt-grant-rollback") as { outcome: string };

    expect(plan).toBeUndefined();
    expect(ledger.outcome).toBe("processing");
  });

  it("revokes plan, pauses watchlists, and marks the ledger processed atomically", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
      ) VALUES ('user-1', 'starter', 'pay-1', 'active', '2026-06-01T00:00:00.000Z');
    `);

    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-revoke-1",
      eventType: "subscription.expired",
      userId: "user-1",
      payloadTimestamp: null,
    });

    await applyDodoPlanRevokeWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        providerSubscriptionId: "sub-1",
        status: "subscription.expired",
        revokedAt: "2026-07-01T00:00:00.000Z",
      },
      0,
      {
        eventId: "evt-revoke-1",
        outcome: "processed",
        metadata: { action: "revoke" },
      },
    );

    const plan = fixtures[0]!.sqlite
      .prepare("SELECT plan, dodo_payment_id FROM user_plan WHERE user_id = ?")
      .get("user-1") as { plan: string; dodo_payment_id: string };
    const activeCount = fixtures[0]!.sqlite
      .prepare("SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ? AND is_active = 1")
      .get("user-1") as { count: number };
    const ledger = fixtures[0]!.sqlite
      .prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
      .get("evt-revoke-1") as { outcome: string };

    expect(plan.plan).toBe("free");
    expect(plan.dodo_payment_id).toBe("pay-1");
    expect(activeCount.count).toBe(0);
    expect(ledger.outcome).toBe("processed");
  });

  it("refunds payment access and reconciles watchlists atomically", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
      ) VALUES ('user-1', 'starter', 'pay-refund', 'active', '2026-06-01T00:00:00.000Z');
    `);

    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-refund-1",
      eventType: "refund.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });

    await applyDodoRefundWithWatchlistReconcile(
      env,
      {
        paymentId: "pay-refund",
        refundedAt: "2026-07-01T00:00:00.000Z",
        userId: "user-1",
      },
      0,
      {
        eventId: "evt-refund-1",
        outcome: "processed",
        metadata: { action: "refund" },
      },
    );

    const plan = fixtures[0]!.sqlite
      .prepare("SELECT plan, dodo_status FROM user_plan WHERE user_id = ?")
      .get("user-1") as { plan: string; dodo_status: string };
    const activeCount = fixtures[0]!.sqlite
      .prepare("SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ? AND is_active = 1")
      .get("user-1") as { count: number };

    expect(plan.plan).toBe("free");
    expect(plan.dodo_status).toBe("refunded");
    expect(activeCount.count).toBe(0);
  });

  it("reclaims a stale processing lease after a crash", async () => {
    const env = openEnv();
    const harness = fixtures[0] ?? openEnv();
    const staleStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    harness.sqlite.exec(`
      INSERT INTO dodo_webhook_event (
        event_id, event_type, user_id, received_at, outcome, processing_started_at, metadata_json
      ) VALUES ('evt-stale', 'payment.succeeded', 'user-1', '${staleStartedAt}', 'processing', '${staleStartedAt}', '{}');
    `);

    const second = await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-stale",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });

    expect(second).toEqual({ status: "claimed" });
  });

  it("does not steal a fresh processing lease", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    const freshStartedAt = new Date().toISOString();
    harness.sqlite.exec(`
      INSERT INTO dodo_webhook_event (
        event_id, event_type, user_id, received_at, outcome, processing_started_at, metadata_json
      ) VALUES ('evt-fresh', 'payment.succeeded', 'user-1', '${freshStartedAt}', 'processing', '${freshStartedAt}', '{}');
    `);

    const second = await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-fresh",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });

    expect(second).toEqual({ status: "in_progress" });
  });

  it("allows retry after failDodoWebhookEventProcessing marks the event failed", async () => {
    const env = openEnv();
    const first = await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-retry",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });
    expect(first).toEqual({ status: "claimed" });

    await failDodoWebhookEventProcessing(env, "evt-retry", { error: "boom" });

    const second = await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-retry",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });
    expect(second).toEqual({ status: "claimed" });
  });
});

describe("capacity skip idempotency (sqlite)", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length > 0) {
      fixtures.pop()?.close();
    }
  });

  function openEnv() {
    const harness = createSqliteD1();
    fixtures.push(harness);
    harness.sqlite.exec(`
      CREATE TABLE watchlist (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_fingerprint TEXT NOT NULL,
        target_label TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, is_active, created_at, updated_at)
      VALUES ('wl-1', 'user-1', 'One', 'saved_query', 'sq-1', 'fp-1', 'One', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

      CREATE TABLE watchlist_run (
        id TEXT PRIMARY KEY NOT NULL,
        watchlist_id TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL,
        page_budget INTEGER NOT NULL DEFAULT 0,
        pages_scanned INTEGER NOT NULL DEFAULT 0,
        baseline_from_run_id TEXT,
        summary_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_code TEXT,
        error_message TEXT,
        idempotency_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX idx_watchlist_run_idempotency_key
        ON watchlist_run(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
    return { DB: harness.db } as never;
  }

  it("records only one capacity skip per nightly window", async () => {
    const env = openEnv();
    const scheduledTime = Date.parse("2026-06-23T04:00:00.000Z");
    const input = {
      scheduledTime,
      cron: "0 4 * * *",
    };

    const first = await recordWatchlistCapacitySkip(env, "wl-1", input);
    const second = await recordWatchlistCapacitySkip(env, "wl-1", input);

    expect(second).toBe(first);
    const count = fixtures[0]!.sqlite
      .prepare("SELECT COUNT(*) AS count FROM watchlist_run WHERE watchlist_id = ? AND status = 'skipped'")
      .get("wl-1") as { count: number };
    expect(count.count).toBe(1);
  });

  it("allows a new skip on the next nightly window", async () => {
    const env = openEnv();
    await recordWatchlistCapacitySkip(env, "wl-1", {
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
    });
    await recordWatchlistCapacitySkip(env, "wl-1", {
      scheduledTime: Date.parse("2026-06-24T04:00:00.000Z"),
      cron: "0 4 * * *",
    });

    const count = fixtures[0]!.sqlite
      .prepare("SELECT COUNT(*) AS count FROM watchlist_run WHERE watchlist_id = ? AND status = 'skipped'")
      .get("wl-1") as { count: number };
    expect(count.count).toBe(2);
  });

  it("builds deterministic idempotency keys per watchlist and window", () => {
    const key = buildCapacitySkipIdempotencyKey({
      watchlistId: "wl-1",
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
    });
    expect(key).toContain("wl-1");
    expect(key).toContain("capacity_budget");
  });
});
