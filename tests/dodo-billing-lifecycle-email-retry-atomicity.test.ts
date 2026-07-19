import { afterEach, describe, expect, it } from "vitest";

import { createDodoBillingAtomicityContext } from "./helpers/dodo-billing-atomicity";

const {
  fixtures,
  cleanup,
  openEnv,
  beginDodoWebhookEventProcessing,
  failDodoWebhookEventForLifecycleEmailRetry,
  failDodoWebhookEventProcessing,
  finalizeDodoWebhookLedgerOnly,
} = createDodoBillingAtomicityContext();

describe("Dodo billing atomicity (sqlite)", () => {
  afterEach(cleanup);

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
});
