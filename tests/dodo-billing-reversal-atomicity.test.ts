import { afterEach, describe, expect, it } from "vitest";

import { applyDodoProofCreditGrantWithLedger } from "~/lib/data.server";
import { createDodoBillingAtomicityContext } from "./helpers/dodo-billing-atomicity";
import { effectivePlanFromRow } from "~/lib/plan-effective.server";

const {
	fixtures,
	cleanup,
	openEnv,
	starterGrant,
	processedLedger,
	beginSubEvent,
	applyStarterGrant,
	reverseStarter,
	lifecycleOutboxSpec,
	applyDodoPlanGrantWithWatchlistReconcile,
	applyDodoPlanRevokeWithWatchlistReconcile,
	applyDodoRefundWithWatchlistReconcile,
	beginDodoWebhookEventProcessing,
} = createDodoBillingAtomicityContext();

describe("Dodo billing atomicity (sqlite)", () => {
	afterEach(cleanup);

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
				user_id, plan, dodo_payment_id, dodo_subscription_id, dodo_status, plan_updated_at
			) VALUES ('user-1', 'starter', 'pay-1', 'sub-1', 'active', '2026-06-01T00:00:00.000Z');
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
				user_id, plan, dodo_payment_id, dodo_subscription_id, dodo_status, plan_updated_at
			) VALUES ('user-1', 'free', 'pay-1', 'sub-1', 'refunded', '2026-07-01T00:00:00.000Z');
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

		expect(result).toEqual({ changed: false, stateUpdatedAt: "2026-07-02T00:00:00.000Z" });
		expect(
			fixtures[0]!.sqlite
				.prepare("SELECT plan, dodo_status, plan_updated_at FROM user_plan WHERE user_id = ?")
				.get("user-1"),
		).toMatchObject({ plan: "free", dodo_status: "refunded", plan_updated_at: "2026-07-02T00:00:00.000Z" });
		expect(
			fixtures[0]!.sqlite
				.prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
				.get("evt-terminal-after-refund"),
		).toMatchObject({ outcome: "processed" });
	});

	it("advances a sticky terminal watermark so only a genuinely newer grant can reactivate", async () => {
		const env = openEnv();
		fixtures[0]!.sqlite.exec(`
			INSERT INTO user_plan (user_id, plan, dodo_payment_id, dodo_subscription_id, dodo_status, plan_updated_at)
			VALUES ('user-1', 'starter', 'pay-1', 'sub-1', 'active', '2026-06-01T00:00:00.000Z');
		`);
		const revoke = async (eventId: string, status: string, at: string, withOutbox = false) => {
			await beginDodoWebhookEventProcessing(env, { eventId, eventType: status, userId: "user-1", payloadTimestamp: null });
			return applyDodoPlanRevokeWithWatchlistReconcile(
				env, { userId: "user-1", providerSubscriptionId: "sub-1", status, revokedAt: at }, 0,
				{ eventId, outcome: "processed", metadata: { action: "revoke" } },
				withOutbox ? { lifecycleEmailOutbox: lifecycleOutboxSpec(`billing-cancellation:user-1:${eventId}`) } : {},
			);
		};
		const grant = async (eventId: string, at: string) => {
			await beginDodoWebhookEventProcessing(env, { eventId, eventType: "subscription.renewed", userId: "user-1", payloadTimestamp: null });
			return applyDodoPlanGrantWithWatchlistReconcile(env, starterGrant({ grantedAt: at }), 2, processedLedger(eventId));
		};

		expect(await revoke("evt-terminal-t1", "subscription.cancelled", "2026-07-01T00:00:00.000Z")).toMatchObject({ changed: true });
		expect(await revoke("evt-terminal-t3", "subscription.expired", "2026-07-03T00:00:00.000Z", true)).toMatchObject({ changed: false });
		expect(await grant("evt-delayed-t2", "2026-07-02T00:00:00.000Z")).toEqual({ changed: false });
		expect(fixtures[0]!.sqlite.prepare("SELECT plan, dodo_status, plan_updated_at FROM user_plan WHERE user_id = 'user-1'").get()).toEqual({
			plan: "free", dodo_status: "subscription.cancelled", plan_updated_at: "2026-07-03T00:00:00.000Z",
		});
		expect(fixtures[0]!.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist WHERE is_active = 1").get()).toEqual({ count: 0 });
		expect(fixtures[0]!.sqlite.prepare("SELECT COUNT(*) AS count FROM delivery_attempt WHERE idempotency_key = 'billing-cancellation:user-1:evt-terminal-t3'").get()).toEqual({ count: 0 });

		expect(await grant("evt-new-t4", "2026-07-04T00:00:00.000Z")).toEqual({ changed: true });
		expect(fixtures[0]!.sqlite.prepare("SELECT plan, dodo_status, plan_updated_at FROM user_plan WHERE user_id = 'user-1'").get()).toEqual({
			plan: "starter", dodo_status: "active", plan_updated_at: "2026-07-04T00:00:00.000Z",
		});
		expect(fixtures[0]!.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist WHERE is_active = 1").get()).toEqual({ count: 2 });
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

	it("holds partial top-up refunds for reconciliation while full refunds revoke only the remaining balance", async () => {
		const env = openEnv();
		const harness = fixtures[0]!;
		harness.sqlite.exec(`
			INSERT INTO user_plan (
				user_id, plan, dodo_payment_id, dodo_status, plan_updated_at
			) VALUES ('user-1', 'starter', 'pay-plan', 'active', '2026-06-01T00:00:00.000Z');
			INSERT INTO proof_usage_credit (
				id, user_id, provider, provider_payment_id, provider_product_id,
				bundle_slug, credits, quantity, granted_at, expires_at, metadata_json
			) VALUES (
				'legacy-credit', 'user-1', 'dodo', 'pay-topup', 'prod-topup',
				'evidence-500', 500, 1, '2026-06-01T00:00:00.000Z',
				'9999-12-31T23:59:59.999Z', '{}'
			);
			INSERT INTO evidence_top_up_grant (
				id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id,
				quantity_granted, quantity_remaining, granted_at, status,
				catalog_version, metadata_json
			) VALUES (
				'grant-topup', 'user-1', 'evidence-500', 'pay-topup', 'prod-topup',
				500, 120, '2026-06-01T00:00:00.000Z', 'active', 'v1', '{}'
			);
			INSERT INTO evidence_top_up_ledger_entry (
				id, grant_id, workspace_user_id, entry_type, quantity_delta,
				reservation_id, idempotency_key, metadata_json, created_at
			) VALUES (
				'consume-topup', 'grant-topup', 'user-1', 'consume', -380,
				NULL, 'consume-topup', '{}', '2026-06-15T00:00:00.000Z'
			);
		`);

		await beginDodoWebhookEventProcessing(env, {
			eventId: "evt-partial-topup-refund",
			eventType: "refund.succeeded",
			userId: "user-1",
			payloadTimestamp: null,
		});
		// Partial without money amounts: no automatic top-up clawback.
		const partialNoAmounts = await applyDodoRefundWithWatchlistReconcile(
			env,
			{
				paymentId: "pay-topup",
				refundedAt: "2026-07-01T00:00:00.000Z",
				userId: "user-1",
				refundType: "partial",
			},
			0,
			{
				eventId: "evt-partial-topup-refund",
				outcome: "processed",
				metadata: { action: "refund", paymentId: "pay-topup", refundType: "partial" },
			},
		);

		expect(partialNoAmounts).toEqual({ changed: false, stateUpdatedAt: "2026-07-01T00:00:00.000Z" });
		expect(
			harness.sqlite.prepare("SELECT quantity_remaining, status FROM evidence_top_up_grant WHERE id = ?").get("grant-topup"),
		).toEqual({ quantity_remaining: 120, status: "active" });
		expect(
			harness.sqlite.prepare("SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE entry_type = 'refund'").get(),
		).toEqual({ count: 0 });

		// FIX-9: partial with amounts prorates remaining (half of 120 → claw 60).
		await beginDodoWebhookEventProcessing(env, {
			eventId: "evt-partial-topup-prorated",
			eventType: "refund.succeeded",
			userId: "user-1",
			payloadTimestamp: null,
		});
		const partialProrated = await applyDodoRefundWithWatchlistReconcile(
			env,
			{
				paymentId: "pay-topup",
				refundedAt: "2026-07-01T12:00:00.000Z",
				userId: "user-1",
				refundType: "partial",
				refundAmount: 50,
				paymentAmount: 100,
			},
			0,
			{
				eventId: "evt-partial-topup-prorated",
				outcome: "processed",
				metadata: {
					action: "refund",
					paymentId: "pay-topup",
					refundType: "partial",
					creditMutationPolicy: "prorated_topup_v1",
				},
			},
		);
		expect(partialProrated).toMatchObject({ topUpChanged: true });
		expect(
			harness.sqlite.prepare("SELECT quantity_remaining, status FROM evidence_top_up_grant WHERE id = ?").get("grant-topup"),
		).toEqual({ quantity_remaining: 60, status: "active" });
		expect(
			harness.sqlite.prepare("SELECT expires_at FROM proof_usage_credit WHERE id = ?").get("legacy-credit"),
		).toEqual({ expires_at: "9999-12-31T23:59:59.999Z" });
		expect(
			harness.sqlite.prepare("SELECT plan, dodo_status FROM user_plan WHERE user_id = ?").get("user-1"),
		).toEqual({ plan: "starter", dodo_status: "active" });
		expect(
			harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist WHERE is_active = 1").get(),
		).toEqual({ count: 2 });

		await beginDodoWebhookEventProcessing(env, {
			eventId: "evt-full-topup-refund",
			eventType: "refund.succeeded",
			userId: "user-1",
			payloadTimestamp: null,
		});
		const full = await applyDodoRefundWithWatchlistReconcile(
			env,
			{
				paymentId: "pay-topup",
				refundedAt: "2026-07-02T00:00:00.000Z",
				userId: "user-1",
				refundType: "full",
			},
			0,
			{
				eventId: "evt-full-topup-refund",
				outcome: "processed",
				metadata: { action: "refund", paymentId: "pay-topup", refundType: "full" },
			},
		);

		expect(full).toEqual({
			changed: false,
			stateUpdatedAt: "2026-07-02T00:00:00.000Z",
			topUpChanged: true,
		});
		expect(
			harness.sqlite.prepare("SELECT quantity_remaining, status FROM evidence_top_up_grant WHERE id = ?").get("grant-topup"),
		).toEqual({ quantity_remaining: 0, status: "depleted" });
		expect(
			harness.sqlite.prepare("SELECT quantity_delta FROM evidence_top_up_ledger_entry WHERE idempotency_key = ?").get(
				"dodo-refund:evt-full-topup-refund:pay-topup",
			),
		).toEqual({ quantity_delta: -60 });
		expect(
			harness.sqlite.prepare("SELECT expires_at FROM proof_usage_credit WHERE id = ?").get("legacy-credit"),
		).toEqual({ expires_at: "2026-07-02T00:00:00.000Z" });

		const fullReplay = await applyDodoRefundWithWatchlistReconcile(
			env,
			{
				paymentId: "pay-topup",
				refundedAt: "2026-07-02T00:00:00.000Z",
				userId: "user-1",
				refundType: "full",
			},
			0,
			{
				eventId: "evt-full-topup-refund",
				outcome: "processed",
				metadata: { action: "refund", paymentId: "pay-topup", refundType: "full" },
			},
		);
		expect(fullReplay).toEqual({
			changed: false,
			stateUpdatedAt: "2026-07-02T00:00:00.000Z",
		});
		expect(
			harness.sqlite.prepare(
				"SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE idempotency_key = ?",
			).get("dodo-refund:evt-full-topup-refund:pay-topup"),
		).toEqual({ count: 1 });
	});

	it("lets a delayed top-up grant follow a partial refund but keeps a full refund terminal", async () => {
		const env = openEnv();
		const harness = fixtures[0]!;

		const recordRefund = async (eventId: string, paymentId: string, refundType: "full" | "partial") => {
			await beginDodoWebhookEventProcessing(env, {
				eventId,
				eventType: "refund.succeeded",
				userId: null,
				payloadTimestamp: null,
			});
			await applyDodoRefundWithWatchlistReconcile(
				env,
				{ paymentId, refundedAt: "2026-07-01T00:00:00.000Z", userId: null, refundType },
				0,
				{
					eventId,
					outcome: "processed",
					metadata: { action: "refund", paymentId, refundType },
				},
			);
		};
		const recordGrant = async (eventId: string, paymentId: string) => {
			await beginDodoWebhookEventProcessing(env, {
				eventId,
				eventType: "payment.succeeded",
				userId: "user-1",
				payloadTimestamp: null,
			});
			await applyDodoProofCreditGrantWithLedger(
				env,
				{
					userId: "user-1",
					providerPaymentId: paymentId,
					providerProductId: "prod-topup",
					bundleSlug: "evidence-500",
					credits: 500,
					quantity: 1,
					grantedAt: "2026-06-30T00:00:00.000Z",
				},
				{
					eventId,
					outcome: "processed",
					metadata: { action: "grant", paymentId },
				},
			);
		};

		await recordRefund("evt-partial-before-grant", "pay-partial-before-grant", "partial");
		await recordGrant("evt-grant-after-partial", "pay-partial-before-grant");
		await recordGrant("evt-grant-after-partial-replay", "pay-partial-before-grant");
		await recordRefund("evt-full-before-grant", "pay-full-before-grant", "full");
		await recordGrant("evt-grant-after-full", "pay-full-before-grant");
		await recordGrant("evt-grant-after-full-replay", "pay-full-before-grant");

		expect(
			harness.sqlite.prepare("SELECT quantity_remaining, status FROM evidence_top_up_grant WHERE provider_payment_id = ?").get(
				"pay-partial-before-grant",
			),
		).toEqual({ quantity_remaining: 500, status: "active" });
		expect(
			harness.sqlite.prepare("SELECT COUNT(*) AS count FROM evidence_top_up_grant WHERE provider_payment_id = ?").get(
				"pay-partial-before-grant",
			),
		).toEqual({ count: 1 });
		expect(
			harness.sqlite.prepare("SELECT COUNT(*) AS count FROM evidence_top_up_grant WHERE provider_payment_id = ?").get(
				"pay-full-before-grant",
			),
		).toEqual({ count: 0 });
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

		expect(result).toEqual({ changed: false, stateUpdatedAt: "2026-07-02T00:00:00.000Z" });
		expect(
			fixtures[0]!.sqlite
				.prepare("SELECT plan, dodo_status, plan_updated_at FROM user_plan WHERE user_id = ?")
				.get("user-1"),
		).toMatchObject({ plan: "free", dodo_status: "refunded", plan_updated_at: "2026-07-02T00:00:00.000Z" });
		expect(
			fixtures[0]!.sqlite
				.prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
				.get("evt-refund-after-cancel"),
		).toMatchObject({ outcome: "processed" });
	});

});
