import { afterEach, describe, expect, it } from "vitest";

import {
  claimDodoSubscriptionPlanChange,
  setWatchlistActive,
} from "~/lib/data.server";
import { createDodoBillingAtomicityContext } from "./helpers/dodo-billing-atomicity";

const {
  fixtures,
  cleanup,
  openEnv,
  applyStarterGrant,
  beginDodoWebhookEventProcessing,
  failDodoWebhookEventProcessing,
} = createDodoBillingAtomicityContext();

describe("Dodo billing atomicity (sqlite)", () => {
  afterEach(cleanup);

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

  it("atomically excludes provider processing and the billing canary lease", async () => {
    const env = openEnv();
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-provider-first",
      eventType: "subscription.updated",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "defer_while_locked",
    })).toEqual({ status: "claimed" });

    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "billing-canary-lock:user-1",
      eventType: "billing.canary.lock",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "acquire_lock",
    })).toEqual({ status: "deferred" });

    await failDodoWebhookEventProcessing(env, "evt-provider-first", { released: true });
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "billing-canary-lock:user-1",
      eventType: "billing.canary.lock",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "acquire_lock",
    })).toEqual({ status: "claimed" });

    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-provider-deferred",
      eventType: "refund.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "defer_while_locked",
    })).toEqual({ status: "deferred" });
    expect(
      fixtures[0]!.sqlite.prepare(
        "SELECT COUNT(*) AS count FROM dodo_webhook_event WHERE event_id = ?",
      ).get("evt-provider-deferred"),
    ).toEqual({ count: 0 });
  });

  it("keeps a stale provider lease retryable while the billing canary blocks reclaim", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    const staleStartedAt = "2000-01-01T00:00:00.000Z";
    harness.sqlite.prepare(`
      INSERT INTO dodo_webhook_event (
        event_id, event_type, user_id, received_at, outcome,
        processing_started_at, metadata_json
      ) VALUES (?, 'refund.succeeded', ?, ?, 'processing', ?, '{}')
    `).run(
      "evt-provider-stale-under-canary",
      "user-1",
      staleStartedAt,
      staleStartedAt,
    );

    const lockId = "billing-canary-lock:user-1:stale-provider";
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: lockId,
      eventType: "billing.canary.lock",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "acquire_lock",
    })).toEqual({ status: "claimed" });

    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-provider-stale-under-canary",
      eventType: "refund.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "defer_while_locked",
    })).toEqual({ status: "deferred" });
    expect(harness.sqlite.prepare(`
      SELECT outcome, processing_started_at
      FROM dodo_webhook_event
      WHERE event_id = ?
    `).get("evt-provider-stale-under-canary")).toEqual({
      outcome: "processing",
      processing_started_at: staleStartedAt,
    });

    harness.sqlite.prepare(`
      INSERT INTO dodo_webhook_event (
        event_id, event_type, user_id, received_at, outcome,
        processing_started_at, metadata_json
      ) VALUES (?, 'refund.succeeded', ?, ?, 'received', NULL, '{}')
    `).run(
      "evt-provider-unowned-under-canary",
      "user-1",
      staleStartedAt,
    );
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-provider-unowned-under-canary",
      eventType: "refund.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "defer_while_locked",
    })).toEqual({ status: "deferred" });
    expect(harness.sqlite.prepare(`
      SELECT outcome, processing_started_at
      FROM dodo_webhook_event
      WHERE event_id = ?
    `).get("evt-provider-unowned-under-canary")).toEqual({
      outcome: "received",
      processing_started_at: null,
    });

    await failDodoWebhookEventProcessing(env, lockId, { released: true });
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-provider-stale-under-canary",
      eventType: "refund.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "defer_while_locked",
    })).toEqual({ status: "claimed" });
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-provider-unowned-under-canary",
      eventType: "refund.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "defer_while_locked",
    })).toEqual({ status: "claimed" });
  });

  it("defers provider processing until stale billing canary residue is recovered", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    const lockId = "billing-canary-lock:user-1:stale-residue";
    const providerEventId = "evt-provider-after-stale-canary";
    harness.sqlite.prepare(`
      INSERT INTO dodo_webhook_event (
        event_id, event_type, user_id, received_at, outcome,
        processing_started_at, metadata_json
      ) VALUES (?, 'billing.canary.lock', ?, ?, 'processing', ?, ?)
    `).run(
      lockId,
      "user-1",
      "2000-01-01T00:00:00.000Z",
      "2000-01-01T00:00:00.000Z",
      JSON.stringify({ action: "billing_canary_active" }),
    );

    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: providerEventId,
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "defer_while_locked",
    })).toEqual({ status: "deferred" });
    expect(harness.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM dodo_webhook_event WHERE event_id = ?",
    ).get(providerEventId)).toEqual({ count: 0 });

    harness.sqlite.prepare(`
      UPDATE dodo_webhook_event
      SET outcome = 'failed',
          processing_started_at = NULL,
          metadata_json = '{"action":"billing_canary_recovered"}'
      WHERE event_id = ?
    `).run(lockId);

    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: providerEventId,
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "defer_while_locked",
    })).toEqual({ status: "claimed" });
  });

  it("claims an internal synthetic webhook only while its canary lease is live", async () => {
    const env = openEnv();
    const lockId = "billing-canary-lock:user-1:lease-a";
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-canary-before-lock",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "require_lock",
      billingCanaryLockId: lockId,
    })).toEqual({ status: "deferred" });

    await beginDodoWebhookEventProcessing(env, {
      eventId: lockId,
      eventType: "billing.canary.lock",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "acquire_lock",
    });
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-canary-under-lock",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "require_lock",
      billingCanaryLockId: lockId,
    })).toEqual({ status: "claimed" });
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-canary-wrong-lock",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "require_lock",
      billingCanaryLockId: "billing-canary-lock:user-1:lease-b",
    })).toEqual({ status: "deferred" });
  });

  it("keeps a newer unique canary lease active when an expired worker releases its own lease", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    const oldLockId = "billing-canary-lock:user-1:lease-old";
    const newLockId = "billing-canary-lock:user-1:lease-new";
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: oldLockId,
      eventType: "billing.canary.lock",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "acquire_lock",
    })).toEqual({ status: "claimed" });
    harness.sqlite.prepare(
      "UPDATE dodo_webhook_event SET processing_started_at = ? WHERE event_id = ?",
    ).run("2000-01-01T00:00:00.000Z", oldLockId);
    expect(await beginDodoWebhookEventProcessing(env, {
      eventId: newLockId,
      eventType: "billing.canary.lock",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "acquire_lock",
    })).toEqual({ status: "claimed" });

    await failDodoWebhookEventProcessing(env, oldLockId, { released: true });
    expect(harness.sqlite.prepare(
      "SELECT outcome FROM dodo_webhook_event WHERE event_id = ?",
    ).get(newLockId)).toEqual({ outcome: "processing" });
  });

  it("rejects a canary grant when any same-watermark billing field changed", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    harness.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_payment_id, dodo_product_id, dodo_subscription_id,
        dodo_customer_id, dodo_plan_change_product_id, dodo_status, plan_updated_at,
        evidence_entitlement_anchor, evidence_entitlement_anchor_source
      ) VALUES (
        'user-1', 'starter', 'pay-real', 'prod-starter', 'sub-1', 'cus-1', NULL,
        'active', '2026-07-18T10:00:00.000Z', '2026-07-01T00:00:00.000Z', 'provider'
      );
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "evt-canary-full-snapshot",
      eventType: "payment.succeeded",
      userId: "user-1",
      payloadTimestamp: null,
    });
    harness.sqlite.prepare(
      "UPDATE user_plan SET dodo_status = 'cancellation_scheduled' WHERE user_id = 'user-1'",
    ).run();

    const result = await applyStarterGrant(
      env,
      "evt-canary-full-snapshot",
      {
        providerPaymentId: "pay-canary",
        grantedAt: "2026-07-18T11:00:00.000Z",
        status: "payment.succeeded",
      },
      10,
      {
        billingCanaryPrecondition: {
          plan: "starter",
          planUpdatedAt: "2026-07-18T10:00:00.000Z",
          dodoPaymentId: "pay-real",
          dodoProductId: "prod-starter",
          dodoPlanChangeProductId: null,
          dodoStatus: "active",
          dodoSubscriptionId: "sub-1",
          dodoCustomerId: "cus-1",
          dodoNextBillingAt: null,
          evidenceEntitlementAnchor: "2026-07-01T00:00:00.000Z",
          evidenceEntitlementAnchorSource: "provider",
        },
      },
    );

    expect(result).toEqual({ changed: false });
    expect(harness.sqlite.prepare(
      "SELECT dodo_payment_id, dodo_status, plan_updated_at FROM user_plan WHERE user_id = 'user-1'",
    ).get()).toEqual({
      dodo_payment_id: "pay-real",
      dodo_status: "cancellation_scheduled",
      plan_updated_at: "2026-07-18T10:00:00.000Z",
    });
  });

  it("does not start a subscription plan change while the billing canary lease is active", async () => {
    const env = openEnv();
    const harness = fixtures[0]!;
    harness.sqlite.exec(`
      INSERT INTO user_plan (
        user_id, plan, dodo_product_id, dodo_subscription_id, dodo_status, plan_updated_at
      ) VALUES (
        'user-1', 'starter', 'prod-starter', 'sub-1', 'active', '2026-07-18T10:00:00.000Z'
      );
    `);
    await beginDodoWebhookEventProcessing(env, {
      eventId: "billing-canary-lock:user-1",
      eventType: "billing.canary.lock",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "acquire_lock",
    });

    await expect(claimDodoSubscriptionPlanChange(env, {
      userId: "user-1",
      status: "plan_change_pending",
      providerProductId: "prod-agency",
      currentSubscriptionId: "sub-1",
      currentProductId: "prod-starter",
      currentStatus: "active",
      currentPlanUpdatedAt: "2026-07-18T10:00:00.000Z",
    })).resolves.toBeNull();
    expect(harness.sqlite.prepare(
      "SELECT dodo_status, dodo_plan_change_product_id FROM user_plan WHERE user_id = 'user-1'",
    ).get()).toEqual({ dodo_status: "active", dodo_plan_change_product_id: null });
  });

  it("defers a watchlist state change until the billing canary lease is released", async () => {
    const env = openEnv();
    await beginDodoWebhookEventProcessing(env, {
      eventId: "billing-canary-lock:user-1",
      eventType: "billing.canary.lock",
      userId: "user-1",
      payloadTimestamp: null,
      billingCanaryGuard: "acquire_lock",
    });

    await expect(setWatchlistActive(env, "user-1", "wl-1", false)).resolves.toBe(false);
    await failDodoWebhookEventProcessing(env, "billing-canary-lock:user-1", { released: true });
    await expect(setWatchlistActive(env, "user-1", "wl-1", false)).resolves.toBe(true);
  });
});
