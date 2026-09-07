import {
	applyDodoCancellationReversalWithLedger,
	applyDodoPlanGrantWithWatchlistReconcile,
	applyDodoPlanPaymentIssueWithLedger,
	applyDodoPlanRevokeWithWatchlistReconcile,
	applyDodoRefundWithWatchlistReconcile,
	beginDodoWebhookEventProcessing,
	failDodoWebhookEventForLifecycleEmailRetry,
	failDodoWebhookEventProcessing,
	finalizeDodoWebhookLedgerOnly,
} from "~/lib/data.server";
import { createSqliteD1 } from "./sqlite-d1";

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
      plan_updated_at TEXT,
      evidence_entitlement_anchor TEXT,
      evidence_entitlement_anchor_source TEXT
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

    CREATE TABLE evidence_top_up_grant (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_user_id TEXT NOT NULL,
      sku_slug TEXT NOT NULL,
      provider_payment_id TEXT NOT NULL UNIQUE,
      provider_product_id TEXT NOT NULL,
      quantity_granted INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      granted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      catalog_version TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE evidence_top_up_ledger_entry (
      id TEXT PRIMARY KEY NOT NULL,
      grant_id TEXT NOT NULL,
      workspace_user_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      reservation_id TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
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

export function createDodoBillingAtomicityContext() {
	const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

	function cleanup() {
		while (fixtures.length > 0) fixtures.pop()?.close();
	}

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

	function processedLedger(eventId: string, action = "subscription_grant"): Ledger {
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

	function reverseStarter(env: AtomicEnv, eventId: string, overrides: GrantOverrides = {}) {
		return applyDodoCancellationReversalWithLedger(
			env, starterGrant(overrides), processedLedger(eventId, "cancellation_reversal"),
		);
	}

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

	return {
		fixtures,
		cleanup,
		openEnv,
		starterGrant,
		processedLedger,
		beginSubEvent,
		applyStarterGrant,
		reverseStarter,
		lifecycleOutboxSpec,
		applyDodoCancellationReversalWithLedger,
		applyDodoPlanGrantWithWatchlistReconcile,
		applyDodoPlanPaymentIssueWithLedger,
		applyDodoPlanRevokeWithWatchlistReconcile,
		applyDodoRefundWithWatchlistReconcile,
		beginDodoWebhookEventProcessing,
		failDodoWebhookEventForLifecycleEmailRetry,
		failDodoWebhookEventProcessing,
		finalizeDodoWebhookLedgerOnly,
	};
}
