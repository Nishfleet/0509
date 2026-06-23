import { beforeEach, describe, expect, it } from "vitest";

import {
  ensureCurrentEvidenceUsagePeriod,
  getEvidenceUsageSummary,
  grantEvidenceTopUp,
  releaseEvidenceReservation,
  reserveEvidenceCheck,
  settleEvidenceReservation,
  utcCalendarMonthBounds,
} from "~/lib/evidence-usage.server";
import type { AppEnv } from "~/lib/env.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

type TestEnv = AppEnv & {
  DB: NonNullable<AppEnv["DB"]>;
  sqlite: ReturnType<typeof createSqliteD1>["sqlite"];
};

function createTestEnv(): TestEnv {
  const { db, sqlite } = createSqliteD1();
  sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY);
    CREATE TABLE user_plan (user_id TEXT PRIMARY KEY, plan TEXT NOT NULL);
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
    INSERT INTO user (id) VALUES ('user-1');
    INSERT INTO user_plan (user_id, plan) VALUES ('user-1', 'starter');
  `);
  return { DB: db, sqlite } as TestEnv;
}

describe("evidence usage periods", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  it("creates a UTC calendar month period with plan allowance", async () => {
    const { periodStart, periodEnd } = utcCalendarMonthBounds(new Date("2026-06-15T12:00:00.000Z"));
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "starter");
    expect(period.period_start).toBe(periodStart);
    expect(period.period_end).toBe(periodEnd);
    expect(period.included_allowance).toBe(250);
    expect(period.included_consumed).toBe(0);
  });

  it("consumes included allowance before top-up grants", async () => {
    env.sqlite.exec(`UPDATE user_plan SET plan = 'scout' WHERE user_id = 'user-1'`);
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
    await releaseEvidenceReservation(env, "op-2");

    const summary = await getEvidenceUsageSummary(env, "user-1");
    expect(summary.includedUsed).toBe(1);
    expect(summary.topUpGrantRemaining).toBe(5);
  });

  it("does not double-charge duplicate logical operations", async () => {
    await ensureCurrentEvidenceUsagePeriod(env, "user-1", "starter");
    const first = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "dup-op",
      source: "test",
    });
    await settleEvidenceReservation(env, "dup-op");
    const duplicate = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "dup-op",
      source: "test",
    });
    expect(first.ok).toBe(true);
    expect(duplicate).toEqual({ ok: false, reason: "duplicate" });
  });
});
