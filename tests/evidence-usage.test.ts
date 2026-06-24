import { beforeEach, describe, expect, it } from "vitest";

import {
  ensureCurrentEvidenceUsagePeriod,
  ensureWorkspaceEntitlementAnchor,
  getEvidenceUsageSummary,
  grantEvidenceTopUp,
  migrateLegacyTopUpCreditsIfNeeded,
  rebuildTopUpGrantBalance,
  rebuildWorkspaceTopUpBalance,
  reserveEvidenceCheck,
  settleEvidenceReservation,
} from "~/lib/evidence-usage.server";
import type { AppEnv } from "~/lib/env.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

type TestEnv = AppEnv & {
  DB: NonNullable<AppEnv["DB"]>;
  sqlite: ReturnType<typeof createSqliteD1>["sqlite"];
};

function createTestEnv(plan = "starter") {
  const { db, sqlite } = createSqliteD1();
  sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY);
    CREATE TABLE user_plan (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      dodo_status TEXT,
      dodo_next_billing_at TEXT,
      plan_updated_at TEXT,
      evidence_entitlement_anchor TEXT,
      evidence_entitlement_anchor_source TEXT
    );
    CREATE TABLE evidence_usage_period (
      id TEXT PRIMARY KEY,
      workspace_user_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      plan_family TEXT NOT NULL,
      included_allowance INTEGER NOT NULL,
      included_consumed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_evidence_usage_period_workspace_start
      ON evidence_usage_period(workspace_user_id, period_start);
    CREATE TABLE evidence_top_up_grant (
      id TEXT PRIMARY KEY,
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
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      workspace_user_id TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      reservation_id TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE evidence_usage_reservation (
      id TEXT PRIMARY KEY,
      workspace_user_id TEXT NOT NULL,
      usage_period_id TEXT,
      top_up_grant_id TEXT,
      logical_operation_key TEXT NOT NULL UNIQUE,
      quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      reserved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      settled_at TEXT,
      released_at TEXT,
      source TEXT NOT NULL
    );
    CREATE TABLE proof_usage_credit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credits INTEGER NOT NULL,
      provider_payment_id TEXT,
      granted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE proof_usage_credit_migration (
      legacy_credit_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      workspace_user_id TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE
    );
    INSERT INTO user (id) VALUES ('user-1');
    INSERT INTO user_plan (
      user_id, plan, plan_updated_at, evidence_entitlement_anchor, evidence_entitlement_anchor_source
    ) VALUES ('user-1', '${plan}', '2026-06-23T00:00:00.000Z', '2026-06-23T00:00:00.000Z', 'plan_activation');
  `);
  return { DB: db, sqlite } as TestEnv;
}

describe("evidence usage periods", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  it("creates a subscription-anchored period with plan allowance", async () => {
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "starter");
    expect(period.period_start).toBe("2026-06-23T00:00:00.000Z");
    expect(period.period_end).toBe("2026-07-23T00:00:00.000Z");
    expect(period.included_allowance).toBe(250);
  });

  it("upgrades allowance without resetting consumption", async () => {
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(`UPDATE evidence_usage_period SET included_consumed = 40 WHERE id = ?`)
      .bind(period.id)
      .run();
    const upgraded = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "starter");
    expect(upgraded.included_allowance).toBe(250);
    expect(upgraded.included_consumed).toBe(40);
  });

  it("consumes included allowance before top-up grants", async () => {
    env = createTestEnv("scout");
    const scoutPeriod = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 1, included_consumed = 0 WHERE id = ?`,
    )
      .bind(scoutPeriod.id)
      .run();

    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "pay-1",
      providerProductId: "prod-burst",
      quantityGranted: 5,
    });

    const first = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "op-1",
      source: "test",
    });
    const second = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "op-2",
      source: "test",
    });

    expect(first).toMatchObject({ ok: true, pool: "included" });
    expect(second).toMatchObject({ ok: true, pool: "top_up" });
    await settleEvidenceReservation(env, "op-1");
  });

  it("blocks top-up spending on free plan while retaining balance", async () => {
    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "pay-free",
      providerProductId: "prod-burst",
      quantityGranted: 3,
    });
    env.sqlite.exec(`UPDATE user_plan SET plan = 'free' WHERE user_id = 'user-1'`);
    await env.DB.prepare(`UPDATE evidence_usage_period SET included_allowance = 0, included_consumed = 0`)
      .bind()
      .run();

    const summary = await getEvidenceUsageSummary(env, "user-1");
    expect(summary.topUpRemaining).toBe(3);
    expect(summary.canSpendTopUps).toBe(false);
    expect(summary.totalAvailable).toBe(0);

    const attempt = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "free-op",
      source: "test",
    });
    expect(attempt).toEqual({ ok: false, reason: "top_up_inactive_plan" });
  });

  it("migrates legacy credits once without double counting", async () => {
    env.sqlite.exec(`
      INSERT INTO proof_usage_credit (id, user_id, credits, provider_payment_id, granted_at, expires_at)
      VALUES ('legacy-1', 'user-1', 7, 'legacy-pay-1', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
    `);
    const first = await migrateLegacyTopUpCreditsIfNeeded(env, "user-1");
    const second = await migrateLegacyTopUpCreditsIfNeeded(env, "user-1");
    expect(first.migrated).toBe(1);
    expect(second.migrated).toBe(0);
    const summary = await getEvidenceUsageSummary(env, "user-1");
    expect(summary.topUpRemaining).toBe(7);
  });

  it("keeps ledger cache aligned with derived balance", async () => {
    await ensureCurrentEvidenceUsagePeriod(env, "user-1", "starter");
    await env.DB.prepare(`UPDATE evidence_usage_period SET included_allowance = 0, included_consumed = 0`)
      .bind()
      .run();
    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "pay-ledger",
      providerProductId: "prod-burst",
      quantityGranted: 2,
    });
    const grant = await env.DB.prepare(`SELECT id FROM evidence_top_up_grant LIMIT 1`)
      .bind()
      .first<{ id: string }>();
    const reserved = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "ledger-op",
      source: "test",
      now: "2026-06-24T00:00:00.000Z",
    });
    expect(reserved.ok).toBe(true);
    const rebuilt = await rebuildTopUpGrantBalance(env, grant!.id);
    const workspaceTotal = await rebuildWorkspaceTopUpBalance(env, "user-1");
    expect(rebuilt).toBe(1);
    expect(workspaceTotal).toBe(1);
  });
});

describe("entitlement anchor persistence", () => {
  it("does not move anchor backward on out-of-order input", async () => {
    const env = createTestEnv();
    const first = await ensureWorkspaceEntitlementAnchor(env, "user-1", {
      providerAnchor: "2026-06-23T00:00:00.000Z",
    });
    const second = await ensureWorkspaceEntitlementAnchor(env, "user-1", {
      providerAnchor: "2026-01-01T00:00:00.000Z",
    });
    expect(first.anchor).toBe("2026-06-23T00:00:00.000Z");
    expect(second.anchor).toBe("2026-06-23T00:00:00.000Z");
  });
});
