import { afterEach, describe, expect, it } from "vitest";

import {
  applyDodoCancellationReversalWithLedger,
  applyDodoPlanGrantWithWatchlistReconcile,
  applyDodoPlanPaymentIssueWithLedger,
  applyDodoPlanRevokeWithWatchlistReconcile,
  applyDodoRefundWithWatchlistReconcile,
  beginDodoWebhookEventProcessing,
  buildCapacitySkipIdempotencyKey,
  failDodoWebhookEventProcessing,
  failDodoWebhookEventForLifecycleEmailRetry,
  finalizeDodoWebhookLedgerOnly,
  recordWatchlistCapacitySkip,
} from "~/lib/data.server";
import { effectivePlanFromRow } from "~/lib/plan-effective.server";
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
	      dodo_plan_change_product_id TEXT,
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
    CREATE UNIQUE INDEX idx_delivery_attempt_idempotency
      ON delivery_attempt(idempotency_key);

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

  type AtomicEnv = Parameters<typeof beginDodoWebhookEventProcessing>[0];
  type GrantInput = Parameters<typeof applyDodoPlanGrantWithWatchlistReconcile>[1];
  type GrantOverrides = Partial<GrantInput>;
  type Ledger = Parameters<typeof applyDodoPlanGrantWithWatchlistReconcile>[3];

  function starterGrant(overrides: GrantOverrides = {}): GrantInput {
    return {
      userId: "user-1", plan: "starter", providerPaymentId: null,
      providerProductId: "prod_starter", providerSubscriptionId: "sub-1",
      providerCustomerId: "cus-1", nextBillingAt: "2026-07-20T00:00:00.000Z",
      status: "active", grantedAt: "2026-06-10T00:00:00.000Z",
      ...overrides,
    };
  }

  function processedLedger(
    eventId: string,
    action: "subscription_grant" | "cancellation_reversal" = "subscription_grant",
  ): Ledger {
    return { eventId, outcome: "processed", metadata: { action } };
  }

  function beginSubEvent(
    env: AtomicEnv,
    eventId: string,
    payloadTimestamp: string | null,
    eventType = "subscription.plan_changed",
  ) {
    return beginDodoWebhookEventProcessing(env, { eventId, eventType, userId: "user-1", payloadTimestamp });
  }

  function applyStarterGrant(
    env: AtomicEnv,
    eventId: string,
    overrides: GrantOverrides = {},
    watchlistLimit = 10,
    options: Parameters<typeof applyDodoPlanGrantWithWatchlistReconcile>[4] = {},
  ) {
    return applyDodoPlanGrantWithWatchlistReconcile(
      env, starterGrant(overrides), watchlistLimit, processedLedger(eventId), options,
    );
  }

  function reverseStarter(
    env: AtomicEnv,
    eventId: string,
    overrides: GrantOverrides = {},
  ) {
    return applyDodoCancellationReversalWithLedger(
      env, starterGrant(overrides), processedLedger(eventId, "cancellation_reversal"),
    );
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

  it("reconciles a no-timestamp plan-changed event after a matching payment grant", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    harness.sqlite.exec(`
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_payment_id,
        dodo_product_id,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_plan_change_product_id,
        dodo_status,
        plan_updated_at
      ) VALUES (
        'user-1',
        'scout',
        'pay-old',
        'prod_scout',
        'sub-1',
        'cus-1',
        'prod_starter',
        'plan_change_pending',
        '2026-06-10T00:00:00.000Z'
      );
    `);

    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-plan-change-payment",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });

    await applyDodoPlanGrantWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        plan: "starter",
        providerPaymentId: "pay-new",
        providerProductId: "prod_starter",
        providerSubscriptionId: "sub-1",
        providerCustomerId: "cus-1",
        status: "succeeded",
        grantedAt: "2026-06-10T00:01:00.000Z",
      },
      10,
      {
        eventId: "evt-plan-change-payment",
        outcome: "processed",
        metadata: { action: "plan_grant" },
      },
    );

    const afterPayment = harness.sqlite
      .prepare(`
        SELECT plan, dodo_status, dodo_product_id, dodo_plan_change_product_id
        FROM user_plan
        WHERE user_id = ?
      `)
      .get("user-1") as {
      plan: string;
      dodo_status: string;
      dodo_product_id: string;
      dodo_plan_change_product_id: string | null;
    };

    expect(afterPayment).toEqual({
      plan: "starter",
      dodo_status: "succeeded",
      dodo_product_id: "prod_starter",
      dodo_plan_change_product_id: "prod_starter",
    });

    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-plan-changed-no-timestamp",
      eventType: "subscription.plan_changed",
      userId: "user-1",
      payloadTimestamp: null,
    });

    await applyDodoPlanGrantWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        plan: "starter",
        providerPaymentId: null,
        providerProductId: "prod_starter",
        providerSubscriptionId: "sub-1",
        providerCustomerId: "cus-1",
        nextBillingAt: "2026-07-10T00:00:00.000Z",
        status: "active",
        grantedAt: "2026-06-10T00:02:00.000Z",
        forcePlanChangePending: true,
        requirePlanChangePending: true,
      },
      10,
      {
        eventId: "evt-plan-changed-no-timestamp",
        outcome: "processed",
        metadata: { action: "subscription_grant" },
      },
    );

    const finalPlan = harness.sqlite
      .prepare(`
        SELECT dodo_status, dodo_next_billing_at, dodo_plan_change_product_id
        FROM user_plan
        WHERE user_id = ?
      `)
      .get("user-1") as {
      dodo_status: string;
      dodo_next_billing_at: string | null;
      dodo_plan_change_product_id: string | null;
    };
    const ledger = harness.sqlite
      .prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
      .get("evt-plan-changed-no-timestamp") as { outcome: string };

    expect(finalPlan).toEqual({
      dodo_status: "active",
      dodo_next_billing_at: "2026-07-10T00:00:00.000Z",
      dodo_plan_change_product_id: null,
    });
    expect(ledger.outcome).toBe("processed");
  });

  it("reverses a scheduled cancellation with a CAS timestamp path and keeps unrelated plan changes guarded", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;

    await beginSubEvent(env, "evt-cancel-scheduled", "2026-06-10T00:00:00.000Z");
    await applyStarterGrant(env, "evt-cancel-scheduled", {
      nextBillingAt: "2026-06-20T00:00:00.000Z",
      status: "cancellation_scheduled",
    });
    await beginSubEvent(env, "evt-cancel-reversed", "2026-06-11T00:00:00.000Z");
    const reversed = await reverseStarter(env, "evt-cancel-reversed", {
      grantedAt: "2026-06-11T00:00:00.000Z",
    });

    expect(reversed.changed).toBe(true);
    const row = harness.sqlite
      .prepare(
        `SELECT plan, dodo_status, dodo_next_billing_at, dodo_plan_change_product_id,
                dodo_product_id, dodo_subscription_id, dodo_customer_id, plan_updated_at
         FROM user_plan WHERE user_id = ?`,
      )
      .get("user-1") as {
      plan: string;
      dodo_status: string;
      dodo_next_billing_at: string;
      dodo_plan_change_product_id: string | null;
      dodo_product_id: string;
      dodo_subscription_id: string;
      dodo_customer_id: string;
      plan_updated_at: string;
    };
    expect(row).toMatchObject({
      plan: "starter",
      dodo_status: "active",
      dodo_next_billing_at: "2026-07-20T00:00:00.000Z",
      dodo_plan_change_product_id: null,
      dodo_product_id: "prod_starter",
      dodo_subscription_id: "sub-1",
      dodo_customer_id: "cus-1",
      plan_updated_at: "2026-06-11T00:00:00.000Z",
    });
    expect(effectivePlanFromRow(row)).toBe("starter");
    expect(
      harness.sqlite
        .prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
        .get("evt-cancel-reversed"),
    ).toEqual({ outcome: "processed" });

    await beginSubEvent(env, "evt-unrelated-plan-change", "2026-06-12T00:00:00.000Z");
    const unrelated = await applyStarterGrant(env, "evt-unrelated-plan-change", {
      plan: "agency",
      providerProductId: "prod_agency",
      nextBillingAt: "2026-08-20T00:00:00.000Z",
      grantedAt: "2026-06-12T00:00:00.000Z",
      requirePlanChangePending: true,
      forcePlanChangePending: true,
    }, 75);
    expect(unrelated.changed).toBe(false);
    expect(
      harness.sqlite
        .prepare("SELECT plan, dodo_status, dodo_plan_change_product_id FROM user_plan WHERE user_id = ?")
        .get("user-1"),
    ).toEqual({
      plan: "starter",
      dodo_status: "active",
      dodo_plan_change_product_id: null,
    });
    expect(
      harness.sqlite
        .prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
        .get("evt-unrelated-plan-change"),
    ).toEqual({ outcome: "ignored" });
  });

  it("rejects a cancellation reversal without a verified webhook timestamp", async () => {
    const env = openEnv();

    await expect(
      reverseStarter(env, "evt-cancel-reversal-no-ts", { grantedAt: undefined }),
    ).rejects.toThrow("verified webhook timestamp");
  });

  it("watermarks a newer reversal before an older cancellation arrives", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;

    await beginSubEvent(
      env,
      "evt-active-t1",
      "2026-06-10T00:00:00.000Z",
      "subscription.active",
    );
    await applyStarterGrant(env, "evt-active-t1");
    await beginSubEvent(env, "evt-reversal-t3", "2026-06-12T00:00:00.000Z");
    const reversal = await reverseStarter(env, "evt-reversal-t3", {
      grantedAt: "2026-06-12T00:00:00.000Z",
    });
    expect(reversal.changed).toBe(true);

    await beginSubEvent(env, "evt-cancellation-t2", "2026-06-11T00:00:00.000Z");
    const olderCancellation = await applyStarterGrant(env, "evt-cancellation-t2", {
      nextBillingAt: "2026-06-20T00:00:00.000Z",
      status: "cancellation_scheduled",
      grantedAt: "2026-06-11T00:00:00.000Z",
    });

    expect(olderCancellation.changed).toBe(false);
    const row = harness.sqlite
      .prepare(
        `SELECT plan, dodo_status, dodo_next_billing_at, plan_updated_at
         FROM user_plan WHERE user_id = ?`,
      )
      .get("user-1") as {
      plan: string;
      dodo_status: string;
      dodo_next_billing_at: string;
      plan_updated_at: string;
    };
    expect(row).toEqual({
      plan: "starter",
      dodo_status: "active",
      dodo_next_billing_at: "2026-07-20T00:00:00.000Z",
      plan_updated_at: "2026-06-12T00:00:00.000Z",
    });
    expect(effectivePlanFromRow(row)).toBe("starter");
  });

  it("does not watermark an active row when reversal provider identity mismatches", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;

    await applyStarterGrant(env, "evt-active-mismatch-base");
    await beginSubEvent(env, "evt-reversal-mismatch", "2026-06-12T00:00:00.000Z");
    const reversal = await reverseStarter(env, "evt-reversal-mismatch", {
      providerProductId: "prod_other",
      grantedAt: "2026-06-12T00:00:00.000Z",
    });

    expect(reversal.changed).toBe(false);
    expect(
      harness.sqlite.prepare("SELECT dodo_status, plan_updated_at FROM user_plan WHERE user_id = ?").get("user-1"),
    ).toEqual({ dodo_status: "active", plan_updated_at: "2026-06-10T00:00:00.000Z" });
  });

  it("preserves an unrelated pending plan target while watermarking an active reversal", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;

    await applyStarterGrant(env, "evt-active-pending-target-base");
    harness.sqlite.exec(
      "UPDATE user_plan SET dodo_plan_change_product_id = 'prod_agency' WHERE user_id = 'user-1'",
    );
    await beginSubEvent(env, "evt-reversal-pending-target", "2026-06-12T00:00:00.000Z");
    const reversal = await reverseStarter(env, "evt-reversal-pending-target", {
      grantedAt: "2026-06-12T00:00:00.000Z",
    });

    expect(reversal.changed).toBe(true);
    expect(
      harness.sqlite
        .prepare("SELECT dodo_status, dodo_plan_change_product_id, plan_updated_at FROM user_plan WHERE user_id = ?")
        .get("user-1"),
    ).toEqual({
      dodo_status: "active",
      dodo_plan_change_product_id: "prod_agency",
      plan_updated_at: "2026-06-12T00:00:00.000Z",
    });
  });

  it.each(["succeeded", "payment.succeeded"] as const)(
    "watermarks a newer reversal for paid status %s before an older cancellation",
    async (paidStatus) => {
      const env = openEnv();
      const harness = fixtures[fixtures.length - 1]!;
      const statusKey = paidStatus.replace(".", "-");

      await applyStarterGrant(env, `evt-${statusKey}-t1`, { status: paidStatus });
      await beginSubEvent(
        env,
        `evt-${statusKey}-t3`,
        "2026-06-12T00:00:00.000Z",
      );
      const reversal = await reverseStarter(env, `evt-${statusKey}-t3`, {
        grantedAt: "2026-06-12T00:00:00.000Z",
      });
      expect(reversal.changed).toBe(true);

      const olderCancellation = await applyStarterGrant(env, `evt-${statusKey}-t2`, {
        nextBillingAt: "2026-06-20T00:00:00.000Z",
        status: "cancellation_scheduled",
        grantedAt: "2026-06-11T00:00:00.000Z",
      });
      expect(olderCancellation.changed).toBe(false);

      const row = harness.sqlite
        .prepare("SELECT plan, dodo_status, dodo_next_billing_at, plan_updated_at FROM user_plan WHERE user_id = ?")
        .get("user-1") as {
        plan: string;
        dodo_status: string;
        dodo_next_billing_at: string;
        plan_updated_at: string;
      };
      expect(row).toEqual({
        plan: "starter",
        dodo_status: paidStatus,
        dodo_next_billing_at: "2026-07-20T00:00:00.000Z",
        plan_updated_at: "2026-06-12T00:00:00.000Z",
      });
      expect(effectivePlanFromRow(row)).toBe("starter");
    },
  );

  it("applies matching plan-change confirmations older than the local claim time", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    harness.sqlite.exec(`
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_payment_id,
        dodo_product_id,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_plan_change_product_id,
        dodo_status,
        plan_updated_at
      ) VALUES (
        'user-1',
        'scout',
        'pay-old',
        'prod_scout',
        'sub-1',
        'cus-1',
        'prod_starter',
        'plan_change_pending',
        '2026-06-10T00:02:00.000Z'
      );
    `);

    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-plan-change-provider-time-skew",
      eventType: "subscription.plan_changed",
      userId: "user-1",
      payloadTimestamp: "2026-06-10T00:01:00.000Z",
    });

    await applyDodoPlanGrantWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        plan: "starter",
        providerPaymentId: null,
        providerProductId: "prod_starter",
        providerSubscriptionId: "sub-1",
        providerCustomerId: "cus-1",
        nextBillingAt: "2026-07-10T00:00:00.000Z",
        status: "active",
        grantedAt: "2026-06-10T00:01:00.000Z",
      },
      10,
      {
        eventId: "evt-plan-change-provider-time-skew",
        outcome: "processed",
        metadata: { action: "subscription_grant" },
      },
    );

    const plan = harness.sqlite
      .prepare(`
        SELECT plan, dodo_status, dodo_next_billing_at, dodo_plan_change_product_id
        FROM user_plan
        WHERE user_id = ?
      `)
      .get("user-1") as {
      plan: string;
      dodo_status: string;
      dodo_next_billing_at: string | null;
      dodo_plan_change_product_id: string | null;
    };

    expect(plan).toEqual({
      plan: "starter",
      dodo_status: "active",
      dodo_next_billing_at: "2026-07-10T00:00:00.000Z",
      dodo_plan_change_product_id: null,
    });
  });

  it("preserves the pending target when a plan-change payment issue recovers", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    harness.sqlite.exec(`
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_payment_id,
        dodo_product_id,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_plan_change_product_id,
        dodo_status,
        plan_updated_at
      ) VALUES (
        'user-1',
        'scout',
        'pay-old',
        'prod_scout',
        'sub-1',
        'cus-1',
        'prod_starter',
        'payment.failed',
        '2026-06-10T00:00:00.000Z'
      );
    `);

    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-plan-change-payment-recovered",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });

    await applyDodoPlanGrantWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        plan: "starter",
        providerPaymentId: "pay-new",
        providerProductId: "prod_starter",
        providerSubscriptionId: "sub-1",
        providerCustomerId: "cus-1",
        status: "succeeded",
        grantedAt: "2026-06-10T00:01:00.000Z",
      },
      10,
      {
        eventId: "evt-plan-change-payment-recovered",
        outcome: "processed",
        metadata: { action: "plan_grant" },
      },
    );

    const plan = harness.sqlite
      .prepare("SELECT dodo_status, dodo_plan_change_product_id FROM user_plan WHERE user_id = ?")
      .get("user-1") as { dodo_status: string; dodo_plan_change_product_id: string | null };

    expect(plan).toEqual({
      dodo_status: "succeeded",
      dodo_plan_change_product_id: "prod_starter",
    });
  });

  it("rolls back guarded plan-change grants when watchlist reconciliation fails", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    harness.sqlite.exec(`
      INSERT INTO user_plan (
        user_id,
        plan,
        dodo_payment_id,
        dodo_product_id,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_plan_change_product_id,
        dodo_status,
        plan_updated_at
      ) VALUES (
        'user-1',
        'scout',
        'pay-old',
        'prod_scout',
        'sub-1',
        'cus-1',
        'prod_starter',
        'plan_change_pending',
        '2026-06-10T00:00:00.000Z'
      );
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-plan-change-rollback",
      eventType: "subscription.plan_changed",
      userId: "user-1",
      payloadTimestamp: null,
    });

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
          providerPaymentId: null,
          providerProductId: "prod_starter",
          providerSubscriptionId: "sub-1",
          providerCustomerId: "cus-1",
          nextBillingAt: "2026-07-10T00:00:00.000Z",
          status: "active",
          grantedAt: "2026-06-10T00:02:00.000Z",
          forcePlanChangePending: true,
          requirePlanChangePending: true,
        },
        10,
        {
          eventId: "evt-plan-change-rollback",
          outcome: "processed",
          metadata: { action: "subscription_grant" },
        },
      ),
    ).rejects.toThrow("watchlist reconcile failed");

    const plan = harness.sqlite
      .prepare(`
        SELECT plan, dodo_status, dodo_next_billing_at, dodo_plan_change_product_id
        FROM user_plan
        WHERE user_id = ?
      `)
      .get("user-1") as {
      plan: string;
      dodo_status: string;
      dodo_next_billing_at: string | null;
      dodo_plan_change_product_id: string | null;
    };
    const ledger = harness.sqlite
      .prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
      .get("evt-plan-change-rollback") as { outcome: string };

    expect(plan).toEqual({
      plan: "scout",
      dodo_status: "plan_change_pending",
      dodo_next_billing_at: null,
      dodo_plan_change_product_id: "prod_starter",
    });
    expect(ledger.outcome).toBe("processing");
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

  it("reports a second terminal lifecycle event as unchanged once the workspace is already free", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
      ) VALUES ('user-1', 'free', 'pay-1', 'refunded', '2026-07-01T00:00:00.000Z');
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-terminal-after-refund",
      eventType: "subscription.cancelled",
      userId: "user-1",
      payloadTimestamp: null,
    });

    const result = await applyDodoPlanRevokeWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        providerSubscriptionId: "sub-1",
        status: "subscription.cancelled",
        revokedAt: "2026-07-02T00:00:00.000Z",
      },
      0,
      {
        eventId: "evt-terminal-after-refund",
        outcome: "processed",
        metadata: { action: "revoke" },
      },
    );

    expect(result).toEqual({ changed: false });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT plan, dodo_status FROM user_plan WHERE user_id = ?")
        .get("user-1"),
    ).toMatchObject({ plan: "free", dodo_status: "refunded" });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
        .get("evt-terminal-after-refund"),
    ).toMatchObject({ outcome: "processed" });
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

  it("reports refund reconciliation unchanged when an earlier terminal event already made the plan free", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
      ) VALUES ('user-1', 'free', 'pay-refund', 'subscription.cancelled', '2026-07-01T00:00:00.000Z');
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-refund-after-cancel",
      eventType: "refund.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });

    const result = await applyDodoRefundWithWatchlistReconcile(
      env,
      {
        paymentId: "pay-refund",
        refundedAt: "2026-07-02T00:00:00.000Z",
        userId: "user-1",
      },
      0,
      {
        eventId: "evt-refund-after-cancel",
        outcome: "processed",
        metadata: { action: "refund" },
      },
    );

    expect(result).toEqual({ changed: false });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT plan, dodo_status FROM user_plan WHERE user_id = ?")
        .get("user-1"),
    ).toMatchObject({ plan: "free", dodo_status: "refunded" });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
        .get("evt-refund-after-cancel"),
    ).toMatchObject({ outcome: "processed" });
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

  it("reclaims a processed webhook specifically for a failed lifecycle email retry", async () => {
    const env = openEnv();
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-lifecycle-email-retry",
      eventType: "subscription.on_hold",
      userId: "user-1",
      payloadTimestamp: null,
    });
    await finalizeDodoWebhookLedgerOnly(env, {
      eventId: "evt-lifecycle-email-retry",
      outcome: "processed",
      metadata: { action: "payment_issue" },
    });

    await expect(
      failDodoWebhookEventForLifecycleEmailRetry(env, "evt-lifecycle-email-retry", {
        kind: "payment_issue",
        userId: "user-1",
        idempotencyKey: "billing-payment-issue:user-1:2026-07-01",
        error: "Cloudflare Email send failed: rejected.",
      }),
    ).resolves.toBe(true);

    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT outcome, processed_at, metadata_json FROM dodo_webhook_event WHERE event_id = ?")
        .get("evt-lifecycle-email-retry"),
    ).toMatchObject({
      outcome: "failed",
      processed_at: null,
      metadata_json: expect.stringContaining('"action":"lifecycle_email_retry"'),
    });

    await expect(
      beginDodoWebhookEventProcessing(env, {
        eventId: "evt-lifecycle-email-retry",
        eventType: "subscription.on_hold",
        userId: "user-1",
        payloadTimestamp: null,
      }),
    ).resolves.toEqual({
      status: "claimed",
      lifecycleEmailRetry: {
        kind: "payment_issue",
        userId: "user-1",
        idempotencyKey: "billing-payment-issue:user-1:2026-07-01",
      },
    });
  });

  it("re-arms a lifecycle email retry when the retry run finalized the ledger as ignored", async () => {
    // A redelivered cancellation event whose guarded grant no-ops finalizes
    // the ledger 'ignored' (plan_change_guard_mismatch) while state
    // revalidation still retries the email. A second explicit provider
    // failure must re-arm from 'ignored' too — otherwise the retry is
    // silently dropped and Dodo stops redelivering.
    const env = openEnv();
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-retry-from-ignored",
      eventType: "subscription.plan_changed",
      userId: "user-1",
      payloadTimestamp: null,
    });
    await finalizeDodoWebhookLedgerOnly(env, {
      eventId: "evt-retry-from-ignored",
      outcome: "ignored",
      metadata: { ignoredReason: "plan_change_guard_mismatch" },
    });

    await expect(
      failDodoWebhookEventForLifecycleEmailRetry(env, "evt-retry-from-ignored", {
        kind: "cancellation_scheduled",
        userId: "user-1",
        idempotencyKey: "billing-cancellation:user-1:evt-retry-from-ignored",
        error: "Cloudflare Email send failed: rejected.",
      }),
    ).resolves.toBe(true);

    await expect(
      beginDodoWebhookEventProcessing(env, {
        eventId: "evt-retry-from-ignored",
        eventType: "subscription.plan_changed",
        userId: "user-1",
        payloadTimestamp: null,
      }),
    ).resolves.toEqual({
      status: "claimed",
      lifecycleEmailRetry: {
        kind: "cancellation_scheduled",
        userId: "user-1",
        idempotencyKey: "billing-cancellation:user-1:evt-retry-from-ignored",
      },
    });
  });

  it("keeps an armed lifecycle email retry across a crashed redelivery lease", async () => {
    // Arm the retry, let a redelivery claim it (failed → processing with the
    // claim preserved), then crash that worker. The next lease-expiry reclaim
    // must still surface the retry claim instead of wiping metadata_json.
    const env = openEnv();
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-retry-crash",
      eventType: "subscription.on_hold",
      userId: "user-1",
      payloadTimestamp: null,
    });
    await finalizeDodoWebhookLedgerOnly(env, {
      eventId: "evt-retry-crash",
      outcome: "processed",
      metadata: { action: "payment_issue" },
    });
    await failDodoWebhookEventForLifecycleEmailRetry(env, "evt-retry-crash", {
      kind: "payment_issue",
      userId: "user-1",
      idempotencyKey: "billing-payment-issue:user-1:2026-07-13",
      error: "Cloudflare Email send failed: rejected.",
    });

    const redelivery = await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-retry-crash",
      eventType: "subscription.on_hold",
      userId: "user-1",
      payloadTimestamp: null,
    });
    expect(redelivery.status).toBe("claimed");

    // Crash: the redelivery never finalizes; age its lease past expiry.
    const staleStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    fixtures[0]!.sqlite
      .prepare(
        "UPDATE dodo_webhook_event SET processing_started_at = ? WHERE event_id = ?",
      )
      .run(staleStartedAt, "evt-retry-crash");

    await expect(
      beginDodoWebhookEventProcessing(env, {
        eventId: "evt-retry-crash",
        eventType: "subscription.on_hold",
        userId: "user-1",
        payloadTimestamp: null,
      }),
    ).resolves.toEqual({
      status: "claimed",
      lifecycleEmailRetry: {
        kind: "payment_issue",
        userId: "user-1",
        idempotencyKey: "billing-payment-issue:user-1:2026-07-13",
      },
    });
  });

  function lifecycleOutboxSpec(idempotencyKey: string, templateName = "billing_access_ended") {
    return {
      userId: "user-1",
      email: "owner@example.com",
      idempotencyKey,
      templateName,
      payloadSnapshot: {
        kind: templateName,
        subject: "Your Five to Nine plan has ended",
        bodyHtml: "<p>ended</p>",
        tag: "billing-cancellation",
        billingStateFingerprint: null,
        outboxPendingDispatch: true,
      },
    };
  }

  it("enqueues the lifecycle email outbox row atomically with a revoke", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
      ) VALUES ('user-1', 'starter', 'pay-1', 'active', '2026-06-01T00:00:00.000Z');
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-revoke-outbox",
      eventType: "subscription.expired",
      userId: "user-1",
      payloadTimestamp: null,
    });

    const result = await applyDodoPlanRevokeWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        providerSubscriptionId: "sub-1",
        status: "subscription.expired",
        revokedAt: "2026-07-01T00:00:00.000Z",
      },
      0,
      { eventId: "evt-revoke-outbox", outcome: "processed", metadata: { action: "revoke" } },
      { lifecycleEmailOutbox: lifecycleOutboxSpec("billing-cancellation:user-1:evt-revoke-outbox") },
    );

    expect(result).toEqual({ changed: true });
    // The pending outbox row committed in the SAME batch as the plan
    // mutation and ledger finalize — a crash after this point can no longer
    // lose the email (recovery replays pending rows).
    const outboxRow = fixtures[0]!.sqlite
      .prepare(
        "SELECT status, webhook_status, target_value, template_name, lane, channel, payload_snapshot_json FROM delivery_attempt WHERE idempotency_key = ?",
      )
      .get("billing-cancellation:user-1:evt-revoke-outbox") as Record<string, string>;
    expect(outboxRow).toMatchObject({
      status: "pending",
      webhook_status: "pending",
      target_value: "owner@example.com",
      template_name: "billing_access_ended",
      lane: "customer",
      channel: "email",
    });
    expect(JSON.parse(outboxRow.payload_snapshot_json)).toMatchObject({
      outboxPendingDispatch: true,
    });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
        .get("evt-revoke-outbox"),
    ).toMatchObject({ outcome: "processed" });
    // Watchlists still reconciled despite the extra statement in the batch.
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ? AND is_active = 1")
        .get("user-1"),
    ).toMatchObject({ count: 0 });
  });

  it("does not enqueue the outbox row when the revoke no-ops", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
      ) VALUES ('user-1', 'free', 'pay-1', 'refunded', '2026-07-01T00:00:00.000Z');
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-revoke-noop",
      eventType: "subscription.cancelled",
      userId: "user-1",
      payloadTimestamp: null,
    });

    const result = await applyDodoPlanRevokeWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        providerSubscriptionId: "sub-1",
        status: "subscription.cancelled",
        revokedAt: "2026-07-02T00:00:00.000Z",
      },
      0,
      { eventId: "evt-revoke-noop", outcome: "processed", metadata: { action: "revoke" } },
      { lifecycleEmailOutbox: lifecycleOutboxSpec("billing-cancellation:user-1:evt-revoke-noop") },
    );

    expect(result).toEqual({ changed: false });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT COUNT(*) AS count FROM delivery_attempt")
        .get(),
    ).toMatchObject({ count: 0 });
  });

  it("never aborts the batch when the outbox idempotency key already exists", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
      ) VALUES ('user-1', 'starter', 'pay-1', 'active', '2026-06-01T00:00:00.000Z');
      INSERT INTO delivery_attempt (
        id, user_id, lane, channel, provider, status, webhook_status,
        target_value, template_name, idempotency_key, created_at, updated_at
      ) VALUES (
        'attempt-existing', 'user-1', 'customer', 'email', 'cloudflare_email',
        'failed', 'failed', 'owner@example.com', 'billing_access_ended',
        'billing-cancellation:user-1:evt-revoke-dup', '2026-06-30T00:00:00.000Z', '2026-06-30T00:00:00.000Z'
      );
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-revoke-dup",
      eventType: "subscription.expired",
      userId: "user-1",
      payloadTimestamp: null,
    });

    const result = await applyDodoPlanRevokeWithWatchlistReconcile(
      env,
      {
        userId: "user-1",
        providerSubscriptionId: "sub-1",
        status: "subscription.expired",
        revokedAt: "2026-07-01T00:00:00.000Z",
      },
      0,
      { eventId: "evt-revoke-dup", outcome: "processed", metadata: { action: "revoke" } },
      { lifecycleEmailOutbox: lifecycleOutboxSpec("billing-cancellation:user-1:evt-revoke-dup") },
    );

    // INSERT OR IGNORE: the plan mutation must still land and the existing
    // (failed, in-place-retryable) row must remain untouched.
    expect(result).toEqual({ changed: true });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT plan FROM user_plan WHERE user_id = ?")
        .get("user-1"),
    ).toMatchObject({ plan: "free" });
    const rows = fixtures[0]!.sqlite
      .prepare("SELECT id, status FROM delivery_attempt WHERE idempotency_key = ?")
      .all("billing-cancellation:user-1:evt-revoke-dup") as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "attempt-existing", status: "failed" });
  });

  it("enqueues the outbox row for a payment issue only when the status update applies", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
      ) VALUES ('user-1', 'starter', 'pay-1', 'active', '2026-06-01T00:00:00.000Z');
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-dunning-1",
      eventType: "payment.failed",
      userId: "user-1",
      payloadTimestamp: null,
    });
    const applied = await applyDodoPlanPaymentIssueWithLedger(
      env,
      { userId: "user-1", status: "payment.failed", occurredAt: "2026-07-01T00:00:00.000Z" },
      { eventId: "evt-dunning-1", outcome: "processed", metadata: { action: "payment_issue" } },
      {
        lifecycleEmailOutbox: lifecycleOutboxSpec(
          "billing-payment-issue:user-1:2026-07-01",
          "billing_payment_issue",
        ),
      },
    );
    expect(applied).toEqual({ changed: true });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT COUNT(*) AS count FROM delivery_attempt WHERE idempotency_key = ?")
        .get("billing-payment-issue:user-1:2026-07-01"),
    ).toMatchObject({ count: 1 });

    // A stale, out-of-order event must not enqueue dunning.
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-dunning-stale",
      eventType: "payment.failed",
      userId: "user-1",
      payloadTimestamp: null,
    });
    const stale = await applyDodoPlanPaymentIssueWithLedger(
      env,
      { userId: "user-1", status: "payment.failed", occurredAt: "2026-06-15T00:00:00.000Z" },
      { eventId: "evt-dunning-stale", outcome: "processed", metadata: { action: "payment_issue" } },
      {
        lifecycleEmailOutbox: lifecycleOutboxSpec(
          "billing-payment-issue:user-1:2026-06-15",
          "billing_payment_issue",
        ),
      },
    );
    expect(stale).toEqual({ changed: false });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT COUNT(*) AS count FROM delivery_attempt WHERE idempotency_key = ?")
        .get("billing-payment-issue:user-1:2026-06-15"),
    ).toMatchObject({ count: 0 });
  });

  it("enqueues the outbox row when the scheduled cancellation matches the stored provider identity", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_product_id, dodo_subscription_id, dodo_customer_id,
        dodo_status, plan_updated_at
      ) VALUES (
        'user-1', 'starter', 'prod-starter', 'sub-1', 'cus-1',
        'active', '2026-06-01T00:00:00.000Z'
      );
    `);
    await beginSubEvent(env, "evt-cancel-sched-outbox", null);
    const applied = await applyStarterGrant(
      env,
      "evt-cancel-sched-outbox",
      {
        providerProductId: "prod-starter",
        status: "cancellation_scheduled",
        grantedAt: "2026-07-13T00:00:00.000Z",
        requireProviderIdentityMatch: true,
      },
      3,
      {
        lifecycleEmailOutbox: lifecycleOutboxSpec(
          "billing-cancellation:user-1:evt-cancel-sched-outbox",
          "billing_cancellation_scheduled",
        ),
      },
    );

    expect(applied).toEqual({ changed: true });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT dodo_status FROM user_plan WHERE user_id = ?")
        .get("user-1"),
    ).toMatchObject({ dodo_status: "cancellation_scheduled" });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT status FROM delivery_attempt WHERE idempotency_key = ?")
        .get("billing-cancellation:user-1:evt-cancel-sched-outbox"),
    ).toMatchObject({ status: "pending" });
    // The plan keeps its watchlist entitlement: the grant reconcile even
    // reactivates the plan-limit-paused watchlist up to the limit of 3.
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT COUNT(*) AS count FROM watchlist WHERE user_id = ? AND is_active = 1")
        .get("user-1"),
    ).toMatchObject({ count: 3 });
  });

  it("rejects a newer scheduled cancellation from a replaced subscription without enqueueing email", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_product_id, dodo_subscription_id, dodo_customer_id,
        dodo_next_billing_at, dodo_status, plan_updated_at
      ) VALUES (
        'user-1', 'agency', 'prod-agency', 'sub-replacement', 'cus-replacement',
        '2026-08-20T00:00:00.000Z', 'active', '2026-07-10T00:00:00.000Z'
      );
    `);
    await beginSubEvent(
      env,
      "evt-stale-subscription-cancel",
      "2026-07-14T00:00:00.000Z",
    );
    const applied = await applyStarterGrant(
      env,
      "evt-stale-subscription-cancel",
      {
        providerProductId: "prod-starter",
        providerSubscriptionId: "sub-replaced",
        providerCustomerId: "cus-replaced",
        nextBillingAt: "2026-08-01T00:00:00.000Z",
        status: "cancellation_scheduled",
        grantedAt: "2026-07-14T00:00:00.000Z",
        requireProviderIdentityMatch: true,
      },
      3,
      {
        lifecycleEmailOutbox: lifecycleOutboxSpec(
          "billing-cancellation:user-1:evt-stale-subscription-cancel",
          "billing_cancellation_scheduled",
        ),
      },
    );

    expect(applied).toEqual({ changed: false });
    expect(
      fixtures[0]!.sqlite
        .prepare(`
          SELECT plan, dodo_product_id, dodo_subscription_id, dodo_customer_id,
                 dodo_next_billing_at, dodo_status, plan_updated_at
          FROM user_plan WHERE user_id = ?
        `)
        .get("user-1"),
    ).toEqual({
      plan: "agency",
      dodo_product_id: "prod-agency",
      dodo_subscription_id: "sub-replacement",
      dodo_customer_id: "cus-replacement",
      dodo_next_billing_at: "2026-08-20T00:00:00.000Z",
      dodo_status: "active",
      plan_updated_at: "2026-07-10T00:00:00.000Z",
    });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT COUNT(*) AS count FROM delivery_attempt WHERE idempotency_key = ?")
        .get("billing-cancellation:user-1:evt-stale-subscription-cancel"),
    ).toMatchObject({ count: 0 });
  });

  it("enqueues the outbox row atomically with a refund revoke", async () => {
    const env = openEnv();
    fixtures[0]!.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
      ) VALUES ('user-1', 'starter', 'pay-refund', 'active', '2026-06-01T00:00:00.000Z');
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-refund-outbox",
      eventType: "refund.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });

    const applied = await applyDodoRefundWithWatchlistReconcile(
      env,
      { paymentId: "pay-refund", refundedAt: "2026-07-01T00:00:00.000Z", userId: "user-1" },
      0,
      { eventId: "evt-refund-outbox", outcome: "processed", metadata: { action: "refund" } },
      {
        lifecycleEmailOutbox: lifecycleOutboxSpec(
          "billing-refund:user-1:evt-refund-outbox",
          "billing_refund_revoked",
        ),
      },
    );

    expect(applied).toEqual({ changed: true });
    expect(
      fixtures[0]!.sqlite
        .prepare("SELECT plan, dodo_status FROM user_plan WHERE user_id = ?")
        .get("user-1"),
    ).toMatchObject({ plan: "free", dodo_status: "refunded" });
    expect(fixtures[0]!.sqlite.prepare(`SELECT status,
      json_extract(payload_snapshot_json, '$.refundPaymentId') AS payment_id,
      json_extract(payload_snapshot_json, '$.refundStateUpdatedAt') AS state_updated_at
      FROM delivery_attempt WHERE idempotency_key = ?`).get("billing-refund:user-1:evt-refund-outbox"))
      .toMatchObject({ status: "pending", payment_id: "pay-refund", state_updated_at: "2026-07-01T00:00:00.000Z" });
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

  it("records only one capacity skip per scheduled window", async () => {
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

  it("allows a new skip on the next scheduled window", async () => {
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
