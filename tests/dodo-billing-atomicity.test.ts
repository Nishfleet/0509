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

function seedBillingSchema(
  sqlite: ReturnType<typeof createSqliteD1>["sqlite"],
  options: { omitPayloadTimestamp?: boolean } = {},
) {
  const payloadTimestampColumn = options.omitPayloadTimestamp ? "" : "payload_timestamp TEXT,";
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
      ${payloadTimestampColumn}
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

  function openEnv(options: { omitPayloadTimestamp?: boolean } = {}) {
    const harness = createSqliteD1();
    fixtures.push(harness);
    seedBillingSchema(harness.sqlite, options);
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
		action = "subscription_grant",
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

  it("keeps lease-aware lifecycle transitions when payload timestamps are absent", async () => {
    const env = openEnv({ omitPayloadTimestamp: true });
    const harness = fixtures.at(-1)!;

    await expect(
      beginDodoWebhookEventProcessing(env, {
        eventId: "evt-legacy-payload",
        eventType: "payment.succeeded",
        userId: "user-1",
        payloadTimestamp: "1765459200",
      }),
    ).resolves.toEqual({ status: "claimed" });
    expect(
      harness.sqlite
        .prepare("SELECT outcome, processing_started_at FROM dodo_webhook_event WHERE event_id = ?")
        .get("evt-legacy-payload"),
    ).toEqual({ outcome: "processing", processing_started_at: expect.any(String) });

    await failDodoWebhookEventProcessing(env, "evt-legacy-payload", {
      action: "lifecycle_email_retry",
      kind: "refund",
      userId: "user-1",
      idempotencyKey: "billing-refund:user-1:evt-legacy-payload",
      error: "retry",
    });
    expect(
      harness.sqlite
        .prepare("SELECT outcome, processing_started_at FROM dodo_webhook_event WHERE event_id = ?")
        .get("evt-legacy-payload"),
    ).toEqual({ outcome: "failed", processing_started_at: null });

    await expect(
      beginDodoWebhookEventProcessing(env, {
        eventId: "evt-legacy-payload",
        eventType: "payment.succeeded",
        userId: "user-1",
        payloadTimestamp: "1765459200",
      }),
    ).resolves.toEqual({
      status: "claimed",
      lifecycleEmailRetry: {
        kind: "refund",
        userId: "user-1",
        idempotencyKey: "billing-refund:user-1:evt-legacy-payload",
      },
    });
    await finalizeDodoWebhookLedgerOnly(env, {
      eventId: "evt-legacy-payload",
      outcome: "processed",
      metadata: { action: "legacy_payload_compatibility" },
    });
    expect(
      harness.sqlite
        .prepare("SELECT outcome, processing_started_at FROM dodo_webhook_event WHERE event_id = ?")
        .get("evt-legacy-payload"),
    ).toEqual({ outcome: "processed", processing_started_at: null });
  });

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
