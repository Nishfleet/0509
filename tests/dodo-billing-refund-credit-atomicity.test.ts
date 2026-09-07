import { afterEach, describe, expect, it } from "vitest";

import { applyDodoProofCreditGrantWithLedger } from "~/lib/data.server";
import { createDodoBillingAtomicityContext } from "./helpers/dodo-billing-atomicity";

const {
  fixtures,
  cleanup,
  openEnv,
  applyDodoRefundWithWatchlistReconcile,
  beginDodoWebhookEventProcessing,
} = createDodoBillingAtomicityContext();

describe("Dodo billing refund-credit atomicity (sqlite)", () => {
  afterEach(cleanup);

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
		const partial = await applyDodoRefundWithWatchlistReconcile(
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

		expect(partial).toEqual({ changed: false, stateUpdatedAt: "2026-07-01T00:00:00.000Z" });
		expect(
			harness.sqlite.prepare("SELECT quantity_remaining, status FROM evidence_top_up_grant WHERE id = ?").get("grant-topup"),
		).toEqual({ quantity_remaining: 120, status: "active" });
		expect(
			harness.sqlite.prepare("SELECT expires_at FROM proof_usage_credit WHERE id = ?").get("legacy-credit"),
		).toEqual({ expires_at: "9999-12-31T23:59:59.999Z" });
		expect(
			harness.sqlite.prepare("SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE entry_type = 'refund'").get(),
		).toEqual({ count: 0 });
		expect(
			harness.sqlite.prepare("SELECT plan, dodo_status FROM user_plan WHERE user_id = ?").get("user-1"),
		).toEqual({ plan: "starter", dodo_status: "active" });
		expect(
			harness.sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist WHERE is_active = 1").get(),
		).toEqual({ count: 2 });
		expect(
			harness.sqlite.prepare(`
				SELECT outcome,
				       json_extract(metadata_json, '$.paymentId') AS payment_id,
				       json_extract(metadata_json, '$.refundType') AS refund_type,
				       json_extract(metadata_json, '$.creditMutationPolicy') AS credit_mutation_policy
				FROM dodo_webhook_event
				WHERE event_id = ?
			`).get("evt-partial-topup-refund"),
		).toEqual({
			outcome: "processed",
			payment_id: "pay-topup",
			refund_type: "partial",
			credit_mutation_policy: null,
		});

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
		).toEqual({ quantity_delta: -120 });
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
	});
