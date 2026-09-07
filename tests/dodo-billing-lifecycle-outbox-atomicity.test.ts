import { afterEach, describe, expect, it } from "vitest";

import { createDodoBillingAtomicityContext } from "./helpers/dodo-billing-atomicity";

const {
  fixtures,
  cleanup,
  openEnv,
  processedLedger,
  beginSubEvent,
  applyStarterGrant,
  lifecycleOutboxSpec,
  applyDodoPlanPaymentIssueWithLedger,
  applyDodoPlanRevokeWithWatchlistReconcile,
  applyDodoRefundWithWatchlistReconcile,
  beginDodoWebhookEventProcessing,
} = createDodoBillingAtomicityContext();

describe("Dodo billing atomicity (sqlite)", () => {
  afterEach(cleanup);

	it("enqueues the lifecycle email outbox row atomically with a revoke", async () => {
		const env = openEnv();
		fixtures[0]!.sqlite.exec(`
			INSERT INTO user_plan (
				user_id, plan, dodo_payment_id, dodo_subscription_id, dodo_status, plan_updated_at
			) VALUES ('user-1', 'starter', 'pay-1', 'sub-1', 'active', '2026-06-01T00:00:00.000Z');
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

		expect(result).toEqual({ changed: true, stateUpdatedAt: "2026-07-01T00:00:00.000Z" });
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
			billingMutationStatus: "subscription.expired",
			billingMutationSubscriptionId: "sub-1",
			billingMutationStateUpdatedAt: "2026-07-01T00:00:00.000Z",
		});
		expect(
			fixtures[0]!.sqlite
				.prepare("SELECT outcome FROM dodo_webhook_event WHERE event_id = ?")
				.get("evt-revoke-outbox"),
		).toMatchObject({ outcome: "processed" });
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

		expect(result).toEqual({ changed: false, stateUpdatedAt: "2026-07-02T00:00:00.000Z" });
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
				user_id, plan, dodo_payment_id, dodo_subscription_id, dodo_status, plan_updated_at
			) VALUES ('user-1', 'starter', 'pay-1', 'sub-1', 'active', '2026-06-01T00:00:00.000Z');
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

		expect(result).toEqual({ changed: true, stateUpdatedAt: "2026-07-01T00:00:00.000Z" });
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
			{ userId: "user-1", status: "payment.failed", occurredAt: "2026-07-01T00:00:00.000Z", providerPaymentId: "pay-1" },
			{ eventId: "evt-dunning-1", outcome: "processed", metadata: { action: "payment_issue" } },
			{
				lifecycleEmailOutbox: lifecycleOutboxSpec(
					"billing-payment-issue:user-1:2026-07-01",
					"billing_payment_issue",
				),
			},
		);
		expect(applied).toEqual({ changed: true, stateUpdatedAt: "2026-07-01T00:00:00.000Z" });
		const dunningOutbox = fixtures[0]!.sqlite
			.prepare("SELECT payload_snapshot_json FROM delivery_attempt WHERE idempotency_key = ?")
			.get("billing-payment-issue:user-1:2026-07-01") as { payload_snapshot_json: string };
		expect(JSON.parse(dunningOutbox.payload_snapshot_json)).toMatchObject({
			billingMutationStatus: "payment.failed",
			billingMutationSubscriptionId: null,
			billingMutationPaymentId: "pay-1",
			billingMutationStateUpdatedAt: "2026-07-01T00:00:00.000Z",
		});

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
		expect(stale).toEqual({ changed: false, stateUpdatedAt: "2026-06-15T00:00:00.000Z" });
		expect(
			fixtures[0]!.sqlite
				.prepare("SELECT COUNT(*) AS count FROM delivery_attempt WHERE idempotency_key = ?")
				.get("billing-payment-issue:user-1:2026-06-15"),
		).toMatchObject({ count: 0 });
	});

	it("binds lifecycle mutations to exact subscription or payment identity", async () => {
		const env = openEnv();
		fixtures[0]!.sqlite.exec(`
			INSERT INTO user_plan (user_id, plan, dodo_payment_id, dodo_subscription_id, dodo_customer_id, dodo_status, plan_updated_at)
			VALUES ('user-1', 'starter', 'pay-new', 'sub-new', 'cus-same', 'active', '2026-07-01T00:00:00.000Z');
		`);
		await beginSubEvent(env, "evt-old-sub-revoke", null, "subscription.expired");
		const result = await applyDodoPlanRevokeWithWatchlistReconcile(
			env, { userId: "user-1", providerSubscriptionId: "sub-old", status: "subscription.expired", revokedAt: "2026-07-03T00:00:00.000Z" }, 0,
			processedLedger("evt-old-sub-revoke", "revoke"),
			{ lifecycleEmailOutbox: lifecycleOutboxSpec("billing-cancellation:user-1:evt-old-sub-revoke") },
		);
		expect(result.changed).toBe(false);
		expect(fixtures[0]!.sqlite.prepare("SELECT plan, dodo_status, plan_updated_at FROM user_plan WHERE user_id = 'user-1'").get())
			.toEqual({ plan: "starter", dodo_status: "active", plan_updated_at: "2026-07-01T00:00:00.000Z" });
		expect(fixtures[0]!.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist WHERE is_active = 1").get()).toEqual({ count: 2 });
		expect(fixtures[0]!.sqlite.prepare("SELECT COUNT(*) AS count FROM delivery_attempt WHERE idempotency_key = 'billing-cancellation:user-1:evt-old-sub-revoke'").get()).toEqual({ count: 0 });

		await beginSubEvent(env, "evt-old-sub-issue", null, "subscription.on_hold");
		const mismatched = await applyDodoPlanPaymentIssueWithLedger(
			env, { userId: "user-1", status: "subscription.on_hold", occurredAt: "2026-07-03T00:00:00.000Z", providerSubscriptionId: "sub-old", providerPaymentId: "pay-new" },
			processedLedger("evt-old-sub-issue", "payment_issue"),
			{ lifecycleEmailOutbox: lifecycleOutboxSpec("billing-payment-issue:user-1:old", "billing_payment_issue") },
		);
		expect(mismatched.changed).toBe(false);
		expect(fixtures[0]!.sqlite.prepare("SELECT dodo_status, plan_updated_at FROM user_plan WHERE user_id = 'user-1'").get())
			.toEqual({ dodo_status: "active", plan_updated_at: "2026-07-01T00:00:00.000Z" });
		expect(fixtures[0]!.sqlite.prepare("SELECT COUNT(*) AS count FROM delivery_attempt WHERE idempotency_key = 'billing-payment-issue:user-1:old'").get()).toEqual({ count: 0 });

		await beginSubEvent(env, "evt-payment-only-issue", null, "payment.failed");
		const paymentOnly = await applyDodoPlanPaymentIssueWithLedger(
			env, { userId: "user-1", status: "payment.failed", occurredAt: "2026-07-04T00:00:00.000Z", providerPaymentId: "pay-new" },
			processedLedger("evt-payment-only-issue", "payment_issue"),
		);
		expect(paymentOnly.changed).toBe(true);
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

		expect(applied).toEqual({ changed: true, stateUpdatedAt: "2026-07-01T00:00:00.000Z" });
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
