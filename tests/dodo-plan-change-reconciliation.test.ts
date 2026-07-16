import { afterEach, describe, expect, it } from "vitest";

import {
  isDodoSubscriptionPlanChangeReconciliationDue,
  listStaleDodoSubscriptionPlanChangeClaims,
  reconcileDodoSubscriptionPlanChangeWithAudit,
} from "~/lib/data.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

function seedSchema(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
  sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
    INSERT INTO user (id) VALUES ('owner-1'), ('operator-1');

    CREATE TABLE user_plan (
      user_id TEXT PRIMARY KEY NOT NULL,
      plan TEXT NOT NULL,
      plan_updated_at TEXT NOT NULL,
      dodo_payment_id TEXT,
      dodo_product_id TEXT,
      dodo_status TEXT,
      dodo_subscription_id TEXT,
      dodo_customer_id TEXT,
      dodo_next_billing_at TEXT,
      dodo_plan_change_product_id TEXT
    );

    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      paused_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE web_mention_target (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
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
    CREATE UNIQUE INDEX idx_agent_action_audit_user_idempotency
      ON agent_action_audit(user_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    INSERT INTO user_plan (
      user_id, plan, plan_updated_at, dodo_product_id, dodo_status,
      dodo_subscription_id, dodo_next_billing_at, dodo_plan_change_product_id
    ) VALUES (
      'owner-1', 'scout', '2026-07-16T12:00:00.000Z', 'prod_scout_monthly',
      'plan_change_pending', 'sub_123', '2026-08-04T12:00:00.000Z',
      'prod_starter_monthly'
    );

    INSERT INTO watchlist (id, user_id, is_active, paused_reason, created_at, updated_at)
    VALUES
      ('wl-1', 'owner-1', 1, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('wl-2', 'owner-1', 1, NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('wl-3', 'owner-1', 0, 'plan_limit', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z');
  `);
}

describe("Dodo plan-change reconciliation", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length) fixtures.pop()?.close();
  });

  function openEnv() {
    const harness = createSqliteD1();
    fixtures.push(harness);
    seedSchema(harness.sqlite);
    return { harness, env: { DB: harness.db } as never };
  }

  const claim = {
    subjectUserId: "owner-1",
    actorUserId: "operator-1",
    subscriptionId: "sub_123",
    currentProductId: "prod_scout_monthly",
    pendingProductId: "prod_starter_monthly",
    claimedStatus: "plan_change_pending",
    claimedAt: "2026-07-16T12:00:00.000Z",
  } as const;

  it("only makes stale pending claims eligible for a read-only provider check", () => {
    expect(
      isDodoSubscriptionPlanChangeReconciliationDue(
        "plan_change_pending",
        "2026-07-16T12:00:00.000Z",
        "prod_starter_monthly",
        Date.parse("2026-07-16T13:01:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isDodoSubscriptionPlanChangeReconciliationDue(
        "plan_change_pending",
        "2026-07-16T12:30:00.000Z",
        "prod_starter_monthly",
        Date.parse("2026-07-16T13:01:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isDodoSubscriptionPlanChangeReconciliationDue(
        "plan_change_scheduled",
        "2026-07-15T12:00:00.000Z",
        "prod_starter_monthly",
        Date.parse("2026-07-16T13:01:00.000Z"),
      ),
    ).toBe(false);
  });

  it("lists only expired ambiguous claims for audited operator recovery", async () => {
    const { harness, env } = openEnv();
    harness.sqlite.exec(`
      INSERT INTO user (id) VALUES ('fresh-owner'), ('scheduled-owner');
      INSERT INTO user_plan (
        user_id, plan, plan_updated_at, dodo_product_id, dodo_status,
        dodo_subscription_id, dodo_plan_change_product_id
      ) VALUES
        ('fresh-owner', 'scout', '2026-07-16T12:45:00.000Z', 'prod_scout_monthly',
         'plan_change_pending', 'sub_fresh', 'prod_starter_monthly'),
        ('scheduled-owner', 'scout', '2026-07-15T12:00:00.000Z', 'prod_scout_monthly',
         'plan_change_scheduled', 'sub_scheduled', 'prod_starter_monthly');
    `);

    await expect(
      listStaleDodoSubscriptionPlanChangeClaims(env, {
        now: "2026-07-16T13:01:00.000Z",
        limit: 10,
      }),
    ).resolves.toEqual([
      {
        userId: "owner-1",
        plan: "scout",
        status: "plan_change_pending",
        claimedAt: "2026-07-16T12:00:00.000Z",
      },
    ]);
  });

  it("atomically applies provider-confirmed acceptance and replays without duplicate audit", async () => {
    const { harness, env } = openEnv();
    const input = {
      ...claim,
      outcome: "accepted" as const,
      targetPlan: "starter" as const,
      providerStatus: "active",
      providerProductId: "prod_starter_monthly",
      scheduledChangeProductId: null,
      nextBillingAt: "2026-08-16T12:00:00.000Z",
      observedAt: "2026-07-16T13:02:00.000Z",
    };

    await expect(reconcileDodoSubscriptionPlanChangeWithAudit(env, input)).resolves.toMatchObject({
      ok: true,
      replayed: false,
      outcome: "accepted",
    });
    await expect(reconcileDodoSubscriptionPlanChangeWithAudit(env, input)).resolves.toMatchObject({
      ok: true,
      replayed: true,
      outcome: "accepted",
    });

    expect(
      harness.sqlite.prepare(
        "SELECT plan, dodo_product_id, dodo_status, dodo_plan_change_product_id, dodo_next_billing_at FROM user_plan WHERE user_id = ?",
      ).get("owner-1"),
    ).toMatchObject({
      plan: "starter",
      dodo_product_id: "prod_starter_monthly",
      dodo_status: "active",
      dodo_plan_change_product_id: null,
      dodo_next_billing_at: "2026-08-16T12:00:00.000Z",
    });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toEqual({ count: 1 });
  });

  it("records a scheduled provider change without granting its future plan", async () => {
    const { harness, env } = openEnv();

    await expect(
      reconcileDodoSubscriptionPlanChangeWithAudit(env, {
        ...claim,
        outcome: "scheduled",
        targetPlan: "starter",
        providerStatus: "active",
        providerProductId: "prod_scout_monthly",
        scheduledChangeProductId: "prod_starter_monthly",
        nextBillingAt: "2026-08-16T12:00:00.000Z",
        observedAt: "2026-07-16T13:02:00.000Z",
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "scheduled" });

    expect(
      harness.sqlite.prepare(
        "SELECT plan, dodo_product_id, dodo_status, dodo_plan_change_product_id FROM user_plan WHERE user_id = ?",
      ).get("owner-1"),
    ).toMatchObject({
      plan: "scout",
      dodo_product_id: "prod_scout_monthly",
      dodo_status: "plan_change_scheduled",
      dodo_plan_change_product_id: "prod_starter_monthly",
    });
  });

  it("clears only the stale local hold when Dodo confirms the old plan is still active", async () => {
    const { harness, env } = openEnv();

    await expect(
      reconcileDodoSubscriptionPlanChangeWithAudit(env, {
        ...claim,
        outcome: "unchanged",
        targetPlan: null,
        providerStatus: "active",
        providerProductId: "prod_scout_monthly",
        scheduledChangeProductId: null,
        nextBillingAt: "2026-08-16T12:00:00.000Z",
        observedAt: "2026-07-16T13:02:00.000Z",
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "unchanged" });

    expect(
      harness.sqlite.prepare(
        "SELECT plan, dodo_product_id, dodo_status, dodo_plan_change_product_id FROM user_plan WHERE user_id = ?",
      ).get("owner-1"),
    ).toMatchObject({
      plan: "scout",
      dodo_product_id: "prod_scout_monthly",
      dodo_status: "active",
      dodo_plan_change_product_id: null,
    });
  });

  it("audits still-unknown provider truth without changing the plan or enabling resend", async () => {
    const { harness, env } = openEnv();

    await expect(
      reconcileDodoSubscriptionPlanChangeWithAudit(env, {
        ...claim,
        outcome: "unknown",
        targetPlan: null,
        providerStatus: "unavailable",
        providerProductId: null,
        scheduledChangeProductId: null,
        nextBillingAt: null,
        observedAt: "2026-07-16T13:02:00.000Z",
      }),
    ).resolves.toMatchObject({ ok: true, outcome: "unknown" });

    expect(
      harness.sqlite.prepare(
        "SELECT plan, dodo_status, dodo_plan_change_product_id, plan_updated_at FROM user_plan WHERE user_id = ?",
      ).get("owner-1"),
    ).toMatchObject({
      plan: "scout",
      dodo_status: "plan_change_pending",
      dodo_plan_change_product_id: "prod_starter_monthly",
      plan_updated_at: "2026-07-16T12:00:00.000Z",
    });
    expect(
      harness.sqlite.prepare("SELECT action_name, status FROM agent_action_audit").get(),
    ).toEqual({ action_name: "billing.plan_change.reconcile", status: "succeeded" });
  });

  it("lets a concurrent signed webhook win without leaving a false audit", async () => {
    const { harness, env } = openEnv();
    harness.sqlite.prepare(
      `UPDATE user_plan
       SET plan = 'starter', dodo_product_id = 'prod_starter_monthly',
           dodo_status = 'active', dodo_plan_change_product_id = NULL,
           plan_updated_at = '2026-07-16T13:01:30.000Z'
       WHERE user_id = 'owner-1'`,
    ).run();

    await expect(
      reconcileDodoSubscriptionPlanChangeWithAudit(env, {
        ...claim,
        outcome: "accepted",
        targetPlan: "starter",
        providerStatus: "active",
        providerProductId: "prod_starter_monthly",
        scheduledChangeProductId: null,
        nextBillingAt: "2026-08-16T12:00:00.000Z",
        observedAt: "2026-07-16T13:02:00.000Z",
      }),
    ).resolves.toEqual({ ok: false, reason: "stale" });
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_action_audit").get(),
    ).toEqual({ count: 0 });
  });

  it("fails before any effect when atomic D1 batch support is unavailable", async () => {
    const { harness, env } = openEnv();
    const noBatchEnv = { DB: { ...harness.db, batch: undefined } } as never;

    await expect(
      reconcileDodoSubscriptionPlanChangeWithAudit(noBatchEnv, {
        ...claim,
        outcome: "unchanged",
        targetPlan: null,
        providerStatus: "active",
        providerProductId: "prod_scout_monthly",
        scheduledChangeProductId: null,
        nextBillingAt: null,
        observedAt: "2026-07-16T13:02:00.000Z",
      }),
    ).rejects.toThrow("Atomic D1 batch support is required");
    expect(
      harness.sqlite.prepare("SELECT dodo_status FROM user_plan WHERE user_id = ?").get("owner-1"),
    ).toEqual({ dodo_status: "plan_change_pending" });
  });
});
