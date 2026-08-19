import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EvidenceTopUpReadError,
  ensureCurrentEvidenceUsagePeriod,
  ensureWorkspaceEntitlementAnchor,
  getEvidenceUsageSummary,
  grantEvidenceTopUp,
  applyTopUpRefundAdjustment,
  isEvidenceTopUpReadError,
  isEvidenceUsageStorageUnavailableError,
  listTopUpGrantHistory,
  migrateLegacyTopUpCreditsIfNeeded,
  reconcileStaleEvidenceReservations,
  rebuildTopUpGrantBalance,
  rebuildWorkspaceTopUpBalance,
  reserveEvidenceCheck,
  settleEvidenceReservation,
  tryFinalizeEvidenceForProofCapture,
  tryReleaseEvidenceForProofCapture,
  tryReserveEvidenceForProofCapture,
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
    PRAGMA foreign_keys = ON;
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
    CREATE TABLE watchlist_run (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      processing_token TEXT,
      processing_started_at TEXT
    );
    CREATE TABLE dodo_webhook_event (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      user_id TEXT,
      received_at TEXT NOT NULL,
      processed_at TEXT,
      outcome TEXT NOT NULL,
      processing_started_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE evidence_usage_period (
      id TEXT PRIMARY KEY,
      workspace_user_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      plan_family TEXT NOT NULL,
      included_allowance INTEGER NOT NULL,
      included_consumed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
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
      metadata_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
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
      created_at TEXT NOT NULL,
      FOREIGN KEY (grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
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
      source TEXT NOT NULL,
      owner_run_id TEXT,
      owner_processing_token TEXT,
      owner_lease_seen_at TEXT,
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE,
      FOREIGN KEY (usage_period_id) REFERENCES evidence_usage_period(id) ON DELETE SET NULL,
      FOREIGN KEY (top_up_grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE SET NULL
    );
    CREATE TABLE proof_usage_credit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credits INTEGER NOT NULL,
      provider_payment_id TEXT,
      granted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE proof_usage_credit_migration (
      legacy_credit_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      workspace_user_id TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      FOREIGN KEY (grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    INSERT INTO user (id) VALUES ('user-1');
    INSERT INTO user_plan (
      user_id, plan, plan_updated_at, evidence_entitlement_anchor, evidence_entitlement_anchor_source
    ) VALUES ('user-1', '${plan}', '2026-06-23T00:00:00.000Z', '2026-06-23T00:00:00.000Z', 'plan_activation');
  `);
  // SQLite's in-memory test adapter has one connection, so serialize D1
  // batches while still allowing callers to race at the API boundary.
  const batch = db.batch.bind(db);
  let batchQueue = Promise.resolve();
  const serializedDb = {
    ...db,
    batch<T extends Parameters<typeof db.batch>[0]>(statements: T) {
      const next = batchQueue.then(() => batch(statements));
      batchQueue = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  return { DB: serializedDb, sqlite } as TestEnv;
}

describe("evidence usage periods", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  it("creates a subscription-anchored period with plan allowance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    try {
      const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "starter");
      expect(period.period_start).toBe("2026-06-23T00:00:00.000Z");
      expect(period.period_end).toBe("2026-07-23T00:00:00.000Z");
      expect(period.included_allowance).toBe(250);
    } finally {
      vi.useRealTimers();
    }
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

  it("defers new evidence reservations while the billing canary lease is active", async () => {
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "starter");
    await env.DB.prepare(
      "UPDATE evidence_usage_period SET included_consumed = included_allowance WHERE id = ?",
    ).bind(period.id).run();
    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "billing-canary-credit",
      providerProductId: "prod-burst",
      quantityGranted: 500,
    });
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO dodo_webhook_event (
        event_id, event_type, user_id, received_at, outcome,
        processing_started_at, metadata_json
      ) VALUES (?, 'billing.canary.lock', ?, ?, 'processing', ?, ?)
    `).bind(
      "billing-canary-lock:user-1:lease-a",
      "user-1",
      now,
      now,
      JSON.stringify({ action: "billing_canary_active" }),
    ).run();

    await expect(reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "op-blocked-by-canary",
      source: "test",
    })).resolves.toEqual({ ok: false, reason: "exhausted" });
    expect(env.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM evidence_usage_reservation WHERE logical_operation_key = ?",
    ).get("op-blocked-by-canary")).toEqual({ count: 0 });
    expect(env.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE entry_type = 'consumption'",
    ).get()).toEqual({ count: 0 });

    await env.DB.prepare(
      "UPDATE dodo_webhook_event SET processing_started_at = ? WHERE event_id = ?",
    ).bind("2000-01-01T00:00:00.000Z", "billing-canary-lock:user-1:lease-a").run();
    await expect(reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "op-stale-canary-residue",
      source: "test",
    })).resolves.toEqual({ ok: false, reason: "exhausted" });

    await env.DB.prepare(
      `
        UPDATE dodo_webhook_event
        SET outcome = 'failed', processing_started_at = NULL,
            metadata_json = '{"action":"billing_canary_recovered"}'
        WHERE event_id = ?
      `,
    ).bind("billing-canary-lock:user-1:lease-a").run();
    await expect(reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "op-after-canary",
      source: "test",
    })).resolves.toMatchObject({ ok: true, pool: "top_up" });
  });

  it("settles only an owned atomic reservation and keeps success replay idempotent", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 4, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();

    await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "settle-owned",
      source: "test",
    });

    expect(await settleEvidenceReservation(env, "settle-owned")).toBe(true);
    expect(await settleEvidenceReservation(env, "settle-owned")).toBe(true);

    await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "settle-released",
      source: "test",
    });
    await tryReleaseEvidenceForProofCapture(env, "settle-released");
    expect(await settleEvidenceReservation(env, "settle-released")).toBe(false);
    expect(await settleEvidenceReservation(env, "settle-missing")).toBe(false);

    await env.DB.prepare(
      `
        INSERT INTO evidence_usage_reservation (
          id, workspace_user_id, usage_period_id, top_up_grant_id,
          logical_operation_key, quantity, status, reserved_at, expires_at,
          settled_at, released_at, source
        ) VALUES (?, ?, ?, NULL, ?, 1, 'settled', ?, ?, ?, NULL, 'legacy')
      `,
    )
      .bind(
        "legacy-settled-id",
        "user-1",
        period.id,
        "settle-legacy",
        "2026-07-15T00:00:00.000Z",
        "2026-07-15T00:10:00.000Z",
        "2026-07-15T00:00:01.000Z",
      )
      .run();
    expect(await settleEvidenceReservation(env, "settle-legacy")).toBe(false);
  });

  it("atomically fences settle and release to the current Workflow lease", async () => {
    env = createTestEnv("scout");
    env.sqlite.exec(`
      INSERT INTO watchlist_run (id, status, processing_token)
      VALUES ('run-lease', 'running', 'successor-token');
    `);
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 4, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();

    await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "lease-release",
      source: "test",
      lease: { runId: "run-lease", processingToken: "successor-token" },
    });
    expect(
      await tryFinalizeEvidenceForProofCapture(env, "lease-release", "failed", {
        runId: "run-lease",
        processingToken: "stale-token",
      }),
    ).toBe(false);
    expect(
      env.sqlite.prepare(
        "SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = 'lease-release'",
      ).get(),
    ).toEqual({ status: "pending" });
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 1,
    });

    expect(
      await tryFinalizeEvidenceForProofCapture(env, "lease-release", "failed", {
        runId: "run-lease",
        processingToken: "successor-token",
      }),
    ).toBe(true);

    await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "lease-settle",
      source: "test",
      lease: { runId: "run-lease", processingToken: "successor-token" },
    });
    expect(
      await tryFinalizeEvidenceForProofCapture(env, "lease-settle", "succeeded", {
        runId: "run-lease",
        processingToken: "stale-token",
      }),
    ).toBe(false);
    expect(
      await tryFinalizeEvidenceForProofCapture(env, "lease-settle", "succeeded", {
        runId: "run-lease",
        processingToken: "successor-token",
      }),
    ).toBe(true);
    expect(
      await tryFinalizeEvidenceForProofCapture(env, "lease-settle", "succeeded", {
        runId: "run-lease",
        processingToken: "successor-token",
      }),
    ).toBe(true);
  });

  it("keeps an expired reservation while its Workflow owner is active", async () => {
    env = createTestEnv("scout");
    env.sqlite.exec(`
      INSERT INTO watchlist_run (id, status, processing_token, processing_started_at)
      VALUES (
        'run-active',
        'running',
        'token-active',
        '2026-07-15T00:10:00.000Z'
      );
    `);
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();

    await expect(
      reserveEvidenceCheck(env, {
        workspaceUserId: "user-1",
        logicalOperationKey: "active-owner",
        source: "test",
        now: "2026-07-14T00:00:00.000Z",
        lease: { runId: "run-active", processingToken: "token-active" },
      }),
    ).resolves.toMatchObject({ ok: true, pool: "included" });

    await expect(
      reconcileStaleEvidenceReservations(env, "2026-07-15T00:20:00.000Z"),
    ).resolves.toBe(0);
    expect(
      env.sqlite.prepare(
        "SELECT status, owner_run_id, owner_processing_token FROM evidence_usage_reservation WHERE logical_operation_key = 'active-owner'",
      ).get(),
    ).toEqual({
      status: "pending",
      owner_run_id: "run-active",
      owner_processing_token: "token-active",
    });
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 1,
    });

    env.sqlite.exec(`
      UPDATE watchlist_run
      SET processing_started_at = '2026-07-14T00:00:00.000Z'
      WHERE id = 'run-active';
    `);
    await expect(
      reconcileStaleEvidenceReservations(env, "2026-07-15T00:20:00.000Z"),
    ).resolves.toBe(1);
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 0,
    });
  });

  it("lets a reclaimed Workflow lease adopt the pending reservation and fences the stale owner", async () => {
    env = createTestEnv("scout");
    env.sqlite.exec(`
      INSERT INTO watchlist_run (id, status, processing_token)
      VALUES ('run-reclaimed', 'running', 'token-old');
    `);
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();

    const first = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "reclaimed-owner",
      source: "test",
      now: "2026-07-15T00:00:00.000Z",
      lease: { runId: "run-reclaimed", processingToken: "token-old" },
    });
    expect(first).toMatchObject({ ok: true, pool: "included" });

    env.sqlite.exec(
      `UPDATE watchlist_run SET processing_token = 'token-new' WHERE id = 'run-reclaimed';`,
    );
    const retry = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "reclaimed-owner",
      source: "test",
      now: "2026-07-15T00:20:00.000Z",
      lease: { runId: "run-reclaimed", processingToken: "token-new" },
    });

    expect(retry).toEqual(first);
    expect(
      env.sqlite.prepare(
        "SELECT owner_processing_token, owner_lease_seen_at, expires_at FROM evidence_usage_reservation WHERE logical_operation_key = 'reclaimed-owner'",
      ).get(),
    ).toEqual({
      owner_processing_token: "token-new",
      owner_lease_seen_at: "2026-07-15T00:20:00.000Z",
      expires_at: "2026-07-15T00:35:00.000Z",
    });
    await expect(
      tryFinalizeEvidenceForProofCapture(env, "reclaimed-owner", "succeeded", {
        runId: "run-reclaimed",
        processingToken: "token-old",
      }),
    ).resolves.toBe(false);
    await expect(
      tryFinalizeEvidenceForProofCapture(env, "reclaimed-owner", "succeeded", {
        runId: "run-reclaimed",
        processingToken: "token-new",
      }),
    ).resolves.toBe(true);
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 1,
    });
  });

  it("releases an abandoned Workflow reservation once across concurrent reconcilers", async () => {
    env = createTestEnv("scout");
    env.sqlite.exec(`
      INSERT INTO watchlist_run (id, status, processing_token)
      VALUES ('run-abandoned', 'running', 'token-abandoned');
    `);
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "abandoned-owner",
      source: "test",
      now: "2020-01-01T00:00:00.000Z",
      lease: { runId: "run-abandoned", processingToken: "token-abandoned" },
    });
    env.sqlite.exec(`UPDATE watchlist_run SET status = 'failed' WHERE id = 'run-abandoned';`);

    const results = await Promise.all([
      reconcileStaleEvidenceReservations(env, "2999-01-01T00:00:00.000Z"),
      reconcileStaleEvidenceReservations(env, "2999-01-01T00:00:00.000Z"),
    ]);

    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(
      env.sqlite.prepare(
        "SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = 'abandoned-owner'",
      ).get(),
    ).toEqual({ status: "released" });
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 0,
    });
  });

  it("continues the stale sweep when one compensation batch fails", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 3, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    for (const logicalOperationKey of ["stale-poisoned", "stale-healthy"]) {
      await reserveEvidenceCheck(env, {
        workspaceUserId: "user-1",
        logicalOperationKey,
        source: "test",
        now: "2020-01-01T00:00:00.000Z",
      });
    }

    const realBatch = env.DB.batch.bind(env.DB);
    let failNextBatch = true;
    env.DB.batch = async (statements) => {
      if (failNextBatch) {
        failNextBatch = false;
        throw new Error("injected compensation failure");
      }
      return realBatch(statements);
    };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      reconcileStaleEvidenceReservations(env, "2021-01-01T00:00:00.000Z"),
    ).resolves.toBe(1);
    expect(errorLog).toHaveBeenCalledWith(
      "Evidence reservation reconciliation failed",
      expect.objectContaining({ error: "injected compensation failure" }),
    );
    expect(
      env.sqlite.prepare(
        "SELECT status, COUNT(*) AS count FROM evidence_usage_reservation GROUP BY status ORDER BY status",
      ).all(),
    ).toEqual([
      { status: "pending", count: 1 },
      { status: "released", count: 1 },
    ]);
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 1,
    });
    errorLog.mockRestore();
  });

  it("arbitrates concurrent same-key reservations without double consumption", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();

    const results = await Promise.all([
      reserveEvidenceCheck(env, {
        workspaceUserId: "user-1",
        logicalOperationKey: "same-key",
        source: "test",
      }),
      reserveEvidenceCheck(env, {
        workspaceUserId: "user-1",
        logicalOperationKey: "same-key",
        source: "test",
      }),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ ok: true, pool: "included" });
    expect(
      env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get(),
    ).toEqual({ included_consumed: 1 });
    expect(
      env.sqlite.prepare("SELECT COUNT(*) AS count FROM evidence_usage_reservation").get(),
    ).toEqual({ count: 1 });
  });

  it("never reuses an expired unowned reservation while reconciliation can release it", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "expired-unowned-race",
      source: "test",
      now: "2020-01-01T00:00:00.000Z",
    });

    const [retry, released] = await Promise.all([
      reserveEvidenceCheck(env, {
        workspaceUserId: "user-1",
        logicalOperationKey: "expired-unowned-race",
        source: "test",
        now: "2021-01-01T00:00:00.000Z",
      }),
      reconcileStaleEvidenceReservations(env, "2021-01-01T00:00:00.000Z"),
    ]);

    expect(retry).toEqual({ ok: false, reason: "unavailable" });
    expect(released).toBe(1);
    expect(
      env.sqlite.prepare(
        "SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = 'expired-unowned-race'",
      ).get(),
    ).toEqual({ status: "released" });
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 0,
    });
  });

  it("releases an expired pending reservation before allocating the next check", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    const first = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "expired-op",
      source: "test",
    });
    expect(first.ok).toBe(true);
    await env.DB.prepare(
      `UPDATE evidence_usage_reservation SET expires_at = '2020-01-01T00:00:00.000Z' WHERE logical_operation_key = 'expired-op'`,
    )
      .bind()
      .run();

    await reconcileStaleEvidenceReservations(env);
    const next = await tryReserveEvidenceForProofCapture(env, {
      workspaceUserId: "user-1",
      proofTargetId: "target-1",
      idempotencyKey: "next-op",
      source: "test",
    });
    expect(next?.result).toMatchObject({ ok: true, pool: "included" });
    expect(
      env.sqlite
        .prepare("SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = 'expired-op'")
        .get(),
    ).toEqual({ status: "released" });
    expect(
      env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get(),
    ).toEqual({ included_consumed: 1 });
  });

  it("makes concurrent release callers compensate included usage only once", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    const reservation = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "release-race",
      source: "test",
    });
    expect(reservation).toMatchObject({ ok: true, pool: "included" });

    await Promise.all([
      tryReleaseEvidenceForProofCapture(env, "release-race"),
      tryReleaseEvidenceForProofCapture(env, "release-race"),
    ]);

    expect(
      env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get(),
    ).toEqual({ included_consumed: 0 });
    expect(
      env.sqlite
        .prepare("SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = 'release-race'")
        .get(),
    ).toEqual({ status: "released" });
  });

  it("keeps a released logical key terminal during a retry", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    const first = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "release-retry",
      source: "test",
    });
    expect(first).toMatchObject({ ok: true, pool: "included" });
    await tryReleaseEvidenceForProofCapture(env, "release-retry");

    const retry = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "release-retry",
      source: "test",
    });
    expect(retry).toEqual({ ok: false, reason: "unavailable" });
    expect(
      env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get(),
    ).toEqual({ included_consumed: 0 });
  });

  it("fails closed for a pre-atomic pending row instead of decrementing unrelated usage", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 1 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    await env.DB.prepare(
      `
        INSERT INTO evidence_usage_reservation (
          id, workspace_user_id, usage_period_id, logical_operation_key,
          quantity, status, reserved_at, expires_at, source
        ) VALUES ('legacy-pending', 'user-1', ?, 'legacy-pending-key', 1, 'pending',
          '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', 'legacy')
      `,
    )
      .bind(period.id)
      .run();

    await reconcileStaleEvidenceReservations(env, "2021-01-01T00:00:00.000Z");

    expect(
      env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get(),
    ).toEqual({ included_consumed: 1 });
    expect(
      env.sqlite
        .prepare("SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = 'legacy-pending-key'")
        .get(),
    ).toEqual({ status: "released" });
  });

  it("rolls back an aborted included claim without leaving a pending row", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    const realBatch = env.DB.batch.bind(env.DB);
    env.DB.batch = async (statements) => {
      if (statements.length === 2) {
        return realBatch([statements[0], env.DB.prepare("THIS IS INVALID SQL").bind()]);
      }
      return realBatch(statements);
    };

    await expect(
      reserveEvidenceCheck(env, {
        workspaceUserId: "user-1",
        logicalOperationKey: "aborted-included",
        source: "test",
      }),
    ).rejects.toThrow();
    expect(
      env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get(),
    ).toEqual({ included_consumed: 0 });
    expect(
      env.sqlite
        .prepare("SELECT COUNT(*) AS count FROM evidence_usage_reservation WHERE logical_operation_key = 'aborted-included'")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("rolls back a failed included compensation and reconciles on retry", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 2, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    await expect(
      reserveEvidenceCheck(env, {
        workspaceUserId: "user-1",
        logicalOperationKey: "compensation-retry",
        source: "test",
      }),
    ).resolves.toMatchObject({ ok: true, pool: "included" });

    const realBatch = env.DB.batch.bind(env.DB);
    let failCompensation = true;
    env.DB.batch = async (statements) => {
      if (failCompensation && statements.length === 2) {
        return realBatch([statements[0], env.DB.prepare("THIS IS INVALID SQL").bind()]);
      }
      return realBatch(statements);
    };

    await expect(tryReleaseEvidenceForProofCapture(env, "compensation-retry")).rejects.toThrow();
    expect(
      env.sqlite
        .prepare("SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = 'compensation-retry'")
        .get(),
    ).toEqual({ status: "pending" });
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 1,
    });

    failCompensation = false;
    await expect(tryReleaseEvidenceForProofCapture(env, "compensation-retry")).resolves.toBe(true);
    expect(
      env.sqlite
        .prepare("SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = 'compensation-retry'")
        .get(),
    ).toEqual({ status: "released" });
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 0,
    });
  });

  it("makes concurrent top-up releases idempotent and restores the derived balance once", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 0, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "pay-release-race",
      providerProductId: "prod-burst",
      quantityGranted: 2,
    });

    const reservation = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "top-up-release-race",
      source: "test",
    });
    expect(reservation).toMatchObject({ ok: true, pool: "top_up" });
    await Promise.all([
      tryReleaseEvidenceForProofCapture(env, "top-up-release-race"),
      tryReleaseEvidenceForProofCapture(env, "top-up-release-race"),
    ]);

    const grant = await env.DB.prepare(
      `SELECT quantity_remaining FROM evidence_top_up_grant WHERE provider_payment_id = 'pay-release-race'`,
    )
      .bind()
      .first<{ quantity_remaining: number }>();
    expect(grant).toEqual({ quantity_remaining: 2 });
    expect(
      env.sqlite
        .prepare("SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE entry_type = 'release'")
        .get(),
    ).toEqual({ count: 1 });
  });

  it.each([
    ["explicit full-refund metadata", false],
    ["legacy missing refund reason metadata", true],
  ])("does not restore a top-up reservation after %s", async (_label, removeReason) => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 0, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "pay-refund-pending",
      providerProductId: "prod-burst",
      quantityGranted: 2,
    });

    await expect(
      reserveEvidenceCheck(env, {
        workspaceUserId: "user-1",
        logicalOperationKey: "refund-pending-release",
        source: "test",
      }),
    ).resolves.toMatchObject({ ok: true, pool: "top_up" });

    const grant = env.sqlite.prepare(
      `SELECT id FROM evidence_top_up_grant WHERE provider_payment_id = 'pay-refund-pending'`,
    ).get() as { id: string };
    await expect(
      applyTopUpRefundAdjustment(env, {
        grantId: grant.id,
        workspaceUserId: "user-1",
        quantityDelta: -1,
        reason: "full_provider_refund",
        idempotencyKey: "dodo-refund:evt-pending:pay-refund-pending",
        providerEventId: "evt-pending",
      }),
    ).resolves.toMatchObject({ applied: true });
    if (removeReason) {
      await env.DB.prepare(
        `UPDATE evidence_top_up_ledger_entry SET metadata_json = '{}' WHERE idempotency_key = ?`,
      )
        .bind("dodo-refund:evt-pending:pay-refund-pending")
        .run();
    }

    await expect(
      tryReleaseEvidenceForProofCapture(env, "refund-pending-release"),
    ).resolves.toBe(true);
    await expect(
      tryReleaseEvidenceForProofCapture(env, "refund-pending-release"),
    ).resolves.toBe(true);
    expect(
      env.sqlite.prepare(
        `SELECT quantity_remaining, status FROM evidence_top_up_grant WHERE provider_payment_id = 'pay-refund-pending'`,
      ).get(),
    ).toEqual({ quantity_remaining: 0, status: "depleted" });
    expect(
      env.sqlite.prepare(
        `SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE entry_type = 'release'`,
      ).get(),
    ).toEqual({ count: 0 });
    expect(
      env.sqlite.prepare(
        `SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = 'refund-pending-release'`,
      ).get(),
    ).toEqual({ status: "released" });
  });

  it("restores a failed reservation after a nonterminal partial refund adjustment", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 0, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "pay-partial-pending",
      providerProductId: "prod-burst",
      quantityGranted: 2,
    });
    await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "partial-pending-release",
      source: "test",
    });
    const grant = env.sqlite.prepare(
      `SELECT id FROM evidence_top_up_grant WHERE provider_payment_id = 'pay-partial-pending'`,
    ).get() as { id: string };
    await applyTopUpRefundAdjustment(env, {
      grantId: grant.id,
      workspaceUserId: "user-1",
      quantityDelta: -1,
      reason: "partial_provider_refund",
      idempotencyKey: "operator-refund:evt-partial:pay-partial-pending",
      providerEventId: "evt-partial",
    });

    await expect(
      tryReleaseEvidenceForProofCapture(env, "partial-pending-release"),
    ).resolves.toBe(true);
    expect(
      env.sqlite.prepare(
        `SELECT quantity_remaining, status FROM evidence_top_up_grant WHERE provider_payment_id = 'pay-partial-pending'`,
      ).get(),
    ).toEqual({ quantity_remaining: 1, status: "active" });
    expect(
      env.sqlite.prepare(
        `SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE entry_type = 'release'`,
      ).get(),
    ).toEqual({ count: 1 });
  });

  it("rolls back an aborted top-up claim without leaving a debit or reservation", async () => {
    env = createTestEnv("scout");
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await env.DB.prepare(
      `UPDATE evidence_usage_period SET included_allowance = 0, included_consumed = 0 WHERE id = ?`,
    )
      .bind(period.id)
      .run();
    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "pay-aborted-top-up",
      providerProductId: "prod-burst",
      quantityGranted: 2,
    });
    const realBatch = env.DB.batch.bind(env.DB);
    env.DB.batch = async (statements) => {
      if (statements.length === 3) {
        return realBatch([statements[0], env.DB.prepare("THIS IS INVALID SQL").bind(), statements[2]]);
      }
      return realBatch(statements);
    };

    await expect(
      reserveEvidenceCheck(env, {
        workspaceUserId: "user-1",
        logicalOperationKey: "aborted-top-up",
        source: "test",
      }),
    ).rejects.toThrow();
    expect(
      env.sqlite.prepare("SELECT quantity_remaining FROM evidence_top_up_grant").get(),
    ).toEqual({ quantity_remaining: 2 });
    expect(
      env.sqlite
        .prepare("SELECT COUNT(*) AS count FROM evidence_usage_reservation WHERE logical_operation_key = 'aborted-top-up'")
        .get(),
    ).toEqual({ count: 0 });
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

    const summary = await getEvidenceUsageSummary(env, "user-1");
    expect(summary.topUpRemaining).toBe(3);
    expect(summary.canSpendTopUps).toBe(false);
    // Free carries its own single monthly included check; the purchased
    // top-ups stay retained but unspendable.
    expect(summary.totalAvailable).toBe(1);

    const attempt = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "free-op",
      source: "test",
    });
    expect(attempt).toMatchObject({ ok: true, pool: "included" });
    await settleEvidenceReservation(env, "free-op");

    // With the free included check spent, a further reservation must hit the
    // top-up path and be refused — free never spends purchased checks.
    const secondAttempt = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "free-op-2",
      source: "test",
    });
    expect(secondAttempt).toEqual({ ok: false, reason: "top_up_inactive_plan" });
  });

  it("fails loudly when paid top-up balances cannot be read", async () => {
    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "pay-read-failure",
      providerProductId: "prod-burst",
      quantityGranted: 3,
    });
    const originalCause = new Error("simulated D1 balance outage");
    const realPrepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = ((sql: string) => {
      const statement = realPrepare(sql);
      if (!sql.includes("ORDER BY granted_at ASC")) {
        return statement;
      }
      return {
        bind(...bindings: unknown[]) {
          const bound = statement.bind(...bindings);
          return {
            ...bound,
            async all() {
              throw originalCause;
            },
          };
        },
      };
    }) as typeof env.DB.prepare;

    const error = await getEvidenceUsageSummary(env, "user-1").catch((caught) => caught);

    expect(error).toBeInstanceOf(EvidenceTopUpReadError);
    expect(isEvidenceTopUpReadError(error)).toBe(true);
    expect(error).toMatchObject({
      name: "EvidenceTopUpReadError",
      message: "D1 top-up balance read failed",
      cause: originalCause,
    });
  });

  it("fails loudly when the legacy paid-credit migration join cannot be read", async () => {
    const originalCause = new Error("simulated D1 legacy migration outage");
    const realPrepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = ((sql: string) => {
      const statement = realPrepare(sql);
      if (!sql.includes("LEFT JOIN proof_usage_credit_migration")) {
        return statement;
      }
      return {
        bind(...bindings: unknown[]) {
          const bound = statement.bind(...bindings);
          return {
            ...bound,
            async all() {
              throw originalCause;
            },
          };
        },
      };
    }) as typeof env.DB.prepare;

    const error = await getEvidenceUsageSummary(env, "user-1").catch((caught) => caught);

    expect(error).toBeInstanceOf(EvidenceTopUpReadError);
    expect(isEvidenceTopUpReadError(error)).toBe(true);
    expect(error).toMatchObject({
      name: "EvidenceTopUpReadError",
      message: "D1 legacy top-up migration read failed",
      cause: originalCause,
    });
  });

  it("keeps the pre-ledger absent-table compatibility path", async () => {
    env.sqlite.exec(`
      DROP TABLE proof_usage_credit_migration;
      DROP TABLE proof_usage_credit;
    `);

    await expect(getEvidenceUsageSummary(env, "user-1")).resolves.toMatchObject({
      topUpRemaining: 0,
      totalAvailable: 250,
    });
  });

  it("fails loudly when paid top-up history cannot be read", async () => {
    const originalCause = new Error("simulated D1 history outage");
    const realPrepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = ((sql: string) => {
      const statement = realPrepare(sql);
      if (!sql.includes("ORDER BY granted_at DESC")) {
        return statement;
      }
      return {
        bind(...bindings: unknown[]) {
          const bound = statement.bind(...bindings);
          return {
            ...bound,
            async all() {
              throw originalCause;
            },
          };
        },
      };
    }) as typeof env.DB.prepare;

    const error = await listTopUpGrantHistory(env, "user-1").catch((caught) => caught);

    expect(error).toBeInstanceOf(EvidenceTopUpReadError);
    expect(isEvidenceTopUpReadError(error)).toBe(true);
    expect(error).toMatchObject({
      name: "EvidenceTopUpReadError",
      message: "D1 top-up history read failed",
      cause: originalCause,
    });
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

  it("links legacy migration rows to an existing top-up grant", async () => {
    env.sqlite.exec(`
      INSERT INTO proof_usage_credit (id, user_id, credits, provider_payment_id, granted_at, expires_at)
      VALUES ('legacy-existing-grant', 'user-1', 7, 'legacy-pay-existing', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
      INSERT INTO evidence_top_up_grant (
        id, workspace_user_id, sku_slug, provider_payment_id, provider_product_id,
        quantity_granted, quantity_remaining, granted_at, status, catalog_version, metadata_json
      )
      VALUES (
        'existing-grant-1', 'user-1', 'legacy_migrated_v1', 'legacy-pay-existing', 'legacy',
        7, 7, '2026-01-01T00:00:00.000Z', 'active', 'legacy', '{"legacyCreditId":"legacy-existing-grant"}'
      );
    `);

    const first = await migrateLegacyTopUpCreditsIfNeeded(env, "user-1");
    const second = await migrateLegacyTopUpCreditsIfNeeded(env, "user-1");
    const grantCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM evidence_top_up_grant WHERE provider_payment_id = 'legacy-pay-existing'`,
    )
      .bind()
      .first<{ count: number }>();
    const migration = await env.DB.prepare(
      `SELECT grant_id FROM proof_usage_credit_migration WHERE legacy_credit_id = 'legacy-existing-grant'`,
    )
      .bind()
      .first<{ grant_id: string }>();
    const summary = await getEvidenceUsageSummary(env, "user-1");

    expect(first.migrated).toBe(1);
    expect(second.migrated).toBe(0);
    expect(grantCount?.count).toBe(1);
    expect(migration?.grant_id).toBe("existing-grant-1");
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

describe("evidence usage storage failures", () => {
  it("does not treat D1 foreign-key failures as unavailable sidecar storage", async () => {
    const error = new Error(
      "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)",
    );
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  throw error;
                },
                async all() {
                  throw error;
                },
                async run() {
                  throw error;
                },
              };
            },
          };
        },
      },
    };

    expect(isEvidenceUsageStorageUnavailableError(error.message)).toBe(false);
    expect(
      isEvidenceUsageStorageUnavailableError(
        "D1_ERROR: no such column: evidence_usage_period.included_consumed: SQLITE_ERROR",
      ),
    ).toBe(false);
    expect(
      isEvidenceUsageStorageUnavailableError(
        "D1_ERROR: no such table: evidence_usage_period: SQLITE_ERROR",
      ),
    ).toBe(true);
    await expect(
      tryReserveEvidenceForProofCapture(env as never, {
        workspaceUserId: "user-1",
        proofTargetId: "target-1",
        idempotencyKey: "proof-request-1",
        source: "monitoring.scan",
      }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
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
