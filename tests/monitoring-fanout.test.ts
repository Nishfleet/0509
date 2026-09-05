import { describe, expect, it, vi } from "vitest";

import {
  MONITORING_WORKFLOW_ID_MAX_LENGTH,
  MONITORING_WORKFLOW_ID_PATTERN,
  buildMonitoringWorkflowInstanceId,
  buildWatchlistExecutionIdempotencyKey,
  claimMonitoringConcurrencySlot,
  claimOrchestratedWatchlistRun,
  countHeldMonitoringConcurrencySlots,
  dispatchOrchestratedWatchlistJobsBatch,
  ensureOrchestratedWatchlistRun,
  evaluateScheduledBrowserAccess,
  finishOrchestratedWatchlistRun,
  hasActiveScheduledWatchlistRun,
  isFanoutEnabledForWorkspace,
  markOrchestratedRunDispatched,
  reconcileOrchestratedWatchlistRuns,
  releaseMonitoringConcurrencySlot,
  resolveMonitoringFanoutMode,
  resolveMonitoringFanoutMaxInflight,
  scheduleWatchlistFanout,
} from "~/lib/monitoring-fanout.server";
import type { WatchlistRecord } from "~/lib/types";
import { createSqliteD1 } from "./helpers/sqlite-d1";
import { seedPendingOrchestratedRun } from "./helpers/monitoring-queue-seed";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn(async (_env, userId: string) => {
    if (userId === "agency-owner") return "agency";
    if (userId === "starter-owner") return "starter";
    if (userId === "scout-owner") return "scout";
    return "agency";
  }),
}));

function buildWatchlist(index: number, userId = "agency-owner"): WatchlistRecord {
  return {
    id: `watch-${index}`,
    userId,
    name: `watch ${index}`,
    targetType: "advertiser",
    targetId: `brand-${index}`,
    targetFingerprint: `fp-${index}`,
    targetLabel: `brand-${index}`,
    targetCountry: null,
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

async function seedFanoutSchema(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
  sqlite.exec(`
    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_fingerprint TEXT NOT NULL,
      target_label TEXT NOT NULL,
      target_country TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_scanned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE user_plan (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      dodo_status TEXT,
      dodo_payment_id TEXT,
      dodo_product_id TEXT,
      dodo_subscription_id TEXT,
      dodo_customer_id TEXT,
      dodo_next_billing_at TEXT,
      dodo_plan_change_product_id TEXT,
      plan_updated_at TEXT
    );
    CREATE TABLE watchlist_run (
      id TEXT PRIMARY KEY,
      watchlist_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      page_budget INTEGER NOT NULL DEFAULT 2,
      pages_scanned INTEGER NOT NULL DEFAULT 0,
      baseline_from_run_id TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      idempotency_key TEXT,
      workflow_instance_id TEXT,
      processing_token TEXT,
      processing_started_at TEXT,
      queued_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      retry_after TEXT,
      queue_priority INTEGER NOT NULL DEFAULT 2
    );
    CREATE UNIQUE INDEX idx_watchlist_run_idempotency_key
      ON watchlist_run(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE TABLE monitoring_concurrency_slot (
      slot_index INTEGER PRIMARY KEY,
      holder_run_id TEXT,
      holder_token TEXT,
      leased_at TEXT
    );
  `);
  const insert = sqlite.prepare(
    "INSERT OR IGNORE INTO monitoring_concurrency_slot (slot_index) VALUES (?)",
  );
  for (let slot = 0; slot < 64; slot += 1) {
    insert.run(slot);
  }
}

function workflowEnv(
  db: ReturnType<typeof createSqliteD1>["db"],
  createBatch: ReturnType<typeof vi.fn>,
  overrides: Record<string, unknown> = {},
) {
  return {
    DB: db,
    MONITORING_WORKFLOW: {
      createBatch,
      create: vi.fn(),
      get: vi.fn(async () => ({
        status: async () => ({ status: "running" as const }),
        restart: vi.fn(),
      })),
    },
    MONITORING_FANOUT_MODE: "fanout",
    MONITORING_FANOUT_GLOBAL: "1",
    MONITORING_SCHEDULED_BROWSER_MODE: "all",
    ...overrides,
  } as never;
}

async function seedDispatchFixture() {
  const { db, sqlite } = createSqliteD1();
  await seedFanoutSchema(sqlite);
  const watchlist = buildWatchlist(1);
  const scheduledTime = Date.parse("2026-06-23T04:00:00.000Z");
  const executionKey = buildWatchlistExecutionIdempotencyKey({
    watchlistId: watchlist.id,
    triggerType: "scheduled",
    scheduledTime,
    cron: "0 4 * * *",
  });
  const ensured = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
    watchlistId: watchlist.id,
    triggerType: "scheduled",
    executionKey,
    pageBudget: 2,
    scheduledTime,
  });
  return {
    db,
    sqlite,
    watchlist,
    scheduledTime,
    executionKey,
    runId: ensured.runId,
    workflowInstanceId: await buildMonitoringWorkflowInstanceId(executionKey),
  };
}

describe("monitoring workflow instance IDs", () => {
  it("derives valid Cloudflare workflow IDs from logical execution keys", async () => {
    const cron = "0 4 * * *";
    const scheduledTime = Date.parse("2026-06-23T04:00:00.000Z");
    const executionKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: "watch-1",
      triggerType: "scheduled",
      scheduledTime,
      cron,
    });
    expect(executionKey).toContain("watch-1");
    expect(executionKey).toContain("0-4");

    const workflowId = await buildMonitoringWorkflowInstanceId(executionKey);
    expect(workflowId.length).toBeLessThanOrEqual(MONITORING_WORKFLOW_ID_MAX_LENGTH);
    expect(MONITORING_WORKFLOW_ID_PATTERN.test(workflowId)).toBe(true);
    expect(workflowId.startsWith("monitor-v1-")).toBe(true);
    expect(workflowId).not.toContain(":");
  });

  it("is deterministic and collision-resistant across a large sample", async () => {
    const scheduledTime = Date.parse("2026-06-23T04:00:00.000Z");
    const ids = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const executionKey = buildWatchlistExecutionIdempotencyKey({
        watchlistId: `watch-${index}-${"x".repeat(80)}`,
        triggerType: "scheduled",
        scheduledTime: scheduledTime + index,
        cron: "0 4 * * *",
      });
      const a = await buildMonitoringWorkflowInstanceId(executionKey);
      const b = await buildMonitoringWorkflowInstanceId(executionKey);
      expect(a).toBe(b);
      ids.add(a);
    }
    expect(ids.size).toBe(500);
  });
});

describe("monitoring fan-out rollout gating", () => {
  it("defaults to inline when mode is unset", () => {
    expect(resolveMonitoringFanoutMode({} as never)).toBe("inline");
  });

  it("treats malformed mode as inline", () => {
    expect(resolveMonitoringFanoutMode({ MONITORING_FANOUT_MODE: "bogus" } as never)).toBe("inline");
  });

  it("requires allowlist or global flag for fanout workspaces", () => {
    const baseEnv = {
      MONITORING_FANOUT_MODE: "fanout",
      MONITORING_WORKFLOW: {},
    };
    expect(isFanoutEnabledForWorkspace(baseEnv as never, "agency-owner")).toBe(false);
    expect(
      isFanoutEnabledForWorkspace(
        { ...baseEnv, MONITORING_FANOUT_ALLOWLIST: "agency-owner" } as never,
        "agency-owner",
      ),
    ).toBe(true);
    expect(
      isFanoutEnabledForWorkspace({ ...baseEnv, MONITORING_FANOUT_GLOBAL: "1" } as never, "anyone"),
    ).toBe(true);
  });
});

describe("scheduled Browser Run billing access", () => {
  it("allows successful Dodo payment rows only when they are backed by a subscription SKU", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    sqlite
      .prepare(
        `INSERT INTO user_plan (
          user_id,
          plan,
          dodo_status,
          dodo_product_id,
          dodo_subscription_id,
          dodo_customer_id,
          dodo_next_billing_at,
          plan_updated_at
        ) VALUES
          ('subscription-owner', 'starter', 'payment.succeeded', 'pdt_starter_monthly', 'sub_123', 'cus_123', '2026-08-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'),
          ('dunning-owner', 'starter', 'subscription.on_hold', 'pdt_starter_monthly', 'sub_456', 'cus_456', '2026-08-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'),
          ('plan-change-pending-owner', 'starter', 'plan_change_pending', 'pdt_starter_monthly', 'sub_567', 'cus_567', '2026-08-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'),
          ('plan-change-scheduled-owner', 'starter', 'plan_change_scheduled', 'pdt_starter_monthly', 'sub_568', 'cus_568', '2026-08-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'),
          ('cancel-missing-date-owner', 'starter', 'cancellation_scheduled', 'pdt_starter_monthly', 'sub_789', 'cus_789', NULL, '2026-07-01T00:00:00.000Z'),
          ('cancel-malformed-date-owner', 'starter', 'cancellation_scheduled', 'pdt_starter_monthly', 'sub_790', 'cus_790', 'not-a-date', '2026-07-01T00:00:00.000Z'),
          ('cancel-past-date-owner', 'starter', 'cancellation_scheduled', 'pdt_starter_monthly', 'sub_791', 'cus_791', '2020-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'),
          ('one-time-owner', 'starter', 'payment.succeeded', 'pdt_starter_monthly', NULL, NULL, NULL, '2026-07-01T00:00:00.000Z')`,
      )
      .run();

    const env = {
      DB: db,
      MONITORING_SCHEDULED_BROWSER_MODE: "billing",
      DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "pdt_starter_monthly",
    } as never;

    await expect(evaluateScheduledBrowserAccess(env, "subscription-owner")).resolves.toMatchObject({
      eligible: true,
      reason: "active_subscription",
      plan: "starter",
    });
    await expect(evaluateScheduledBrowserAccess(env, "dunning-owner")).resolves.toMatchObject({
      eligible: true,
      reason: "active_subscription",
      plan: "starter",
    });
    await expect(evaluateScheduledBrowserAccess(env, "plan-change-pending-owner")).resolves.toMatchObject({
      eligible: true,
      reason: "active_subscription",
      plan: "starter",
    });
    await expect(evaluateScheduledBrowserAccess(env, "plan-change-scheduled-owner")).resolves.toMatchObject({
      eligible: true,
      reason: "active_subscription",
      plan: "starter",
    });
    await expect(evaluateScheduledBrowserAccess(env, "cancel-missing-date-owner")).resolves.toMatchObject({
      eligible: true,
      reason: "active_subscription",
      plan: "starter",
    });
    await expect(evaluateScheduledBrowserAccess(env, "cancel-malformed-date-owner")).resolves.toMatchObject({
      eligible: true,
      reason: "active_subscription",
      plan: "starter",
    });
    // A lapsed scheduled cancellation reads as the free plan everywhere
    // (getUserPlanBillingInfo applies the same effective-plan rule as
    // getUserPlan). Free is now entitlement-eligible for scheduled scans
    // (Free Weekly Competitor Watch); the once-a-week time gate lives in
    // shouldSchedulePlanInRegularScan at selection time, and the warmup cron
    // separately skips weekly-cadence plans.
    await expect(evaluateScheduledBrowserAccess(env, "cancel-past-date-owner")).resolves.toMatchObject({
      eligible: true,
      reason: "free_weekly",
      plan: "free",
    });
    await expect(evaluateScheduledBrowserAccess(env, "one-time-owner")).resolves.toMatchObject({
      eligible: false,
      reason: "subscription_required",
      plan: "starter",
      hasSubscriptionId: false,
    });
  });
});

describe("monitoring fan-out scheduling (sqlite)", () => {
  it("schedules 75 eligible watchlists with one logical run each via createBatch", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    sqlite.prepare("INSERT INTO user_plan (user_id, plan) VALUES (?, 'agency')").run("agency-owner");
    const watchlists = Array.from({ length: 75 }, (_v, index) => buildWatchlist(index + 1));
    for (const watchlist of watchlists) {
      sqlite
        .prepare(
          `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, target_country, is_active, last_scanned_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')`,
        )
        .run(
          watchlist.id,
          watchlist.userId,
          watchlist.name,
          watchlist.targetType,
          watchlist.targetId,
          watchlist.targetFingerprint,
          watchlist.targetLabel,
        );
    }

    const createBatch = vi.fn(async (batch: Array<{ id: string }>) =>
      batch.map((item) => ({ id: item.id })),
    );
    const env = workflowEnv(db, createBatch);
    const scheduledTime = Date.parse("2026-06-23T04:00:00.000Z");

    const result = await scheduleWatchlistFanout(env, {
      watchlists,
      scheduledTime,
      cron: "0 4 * * *",
      mode: "fanout",
    });

    const row = sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get() as { count: number };
    expect(result.queued).toBe(75);
    expect(row.count).toBe(75);
    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(createBatch.mock.calls[0]?.[0]).toHaveLength(75);
  });

  it("schedules more than 75 watchlists across multiple workspaces without a global cap", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    sqlite.prepare("INSERT INTO user_plan (user_id, plan) VALUES (?, 'agency')").run("agency-a");
    sqlite.prepare("INSERT INTO user_plan (user_id, plan) VALUES (?, 'agency')").run("agency-b");
    const watchlists = [
      ...Array.from({ length: 40 }, (_v, index) => buildWatchlist(index + 1, "agency-a")),
      ...Array.from({ length: 40 }, (_v, index) => buildWatchlist(index + 41, "agency-b")),
    ];
    for (const watchlist of watchlists) {
      sqlite
        .prepare(
          `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, target_country, is_active, last_scanned_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')`,
        )
        .run(
          watchlist.id,
          watchlist.userId,
          watchlist.name,
          watchlist.targetType,
          watchlist.targetId,
          watchlist.targetFingerprint,
          watchlist.targetLabel,
        );
    }

    const createBatch = vi.fn(async (batch: Array<{ id: string }>) =>
      batch.map((item) => ({ id: item.id })),
    );
    const env = workflowEnv(db, createBatch);
    const result = await scheduleWatchlistFanout(env, {
      watchlists,
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
      mode: "fanout",
    });
    const row = sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get() as { count: number };
    expect(result.queued).toBe(80);
    expect(row.count).toBe(80);
  });

  it("schedules a mixed 75/10/3 fleet with plan-derived queue priorities on Monday", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    sqlite.prepare("INSERT INTO user_plan (user_id, plan) VALUES (?, 'agency')").run("agency-owner");
    sqlite.prepare("INSERT INTO user_plan (user_id, plan) VALUES (?, 'starter')").run("starter-owner");
    sqlite.prepare("INSERT INTO user_plan (user_id, plan) VALUES (?, 'scout')").run("scout-owner");

    const watchlists = [
      ...Array.from({ length: 75 }, (_v, index) => buildWatchlist(index + 1, "agency-owner")),
      ...Array.from({ length: 10 }, (_v, index) => buildWatchlist(index + 76, "starter-owner")),
      ...Array.from({ length: 3 }, (_v, index) => buildWatchlist(index + 86, "scout-owner")),
    ];
    for (const watchlist of watchlists) {
      sqlite
        .prepare(
          `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, target_country, is_active, last_scanned_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')`,
        )
        .run(
          watchlist.id,
          watchlist.userId,
          watchlist.name,
          watchlist.targetType,
          watchlist.targetId,
          watchlist.targetFingerprint,
          watchlist.targetLabel,
        );
    }

    const createBatch = vi.fn(async (batch: Array<{ id: string }>) =>
      batch.map((item) => ({ id: item.id })),
    );
    const env = workflowEnv(db, createBatch);
    const result = await scheduleWatchlistFanout(env, {
      watchlists,
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
      mode: "fanout",
    });

    expect(result.queued).toBe(88);
    const priorities = sqlite
      .prepare(
        `SELECT wr.queue_priority, up.plan
         FROM watchlist_run wr
         INNER JOIN watchlist w ON w.id = wr.watchlist_id
         INNER JOIN user_plan up ON up.user_id = w.user_id
         ORDER BY wr.queue_priority ASC`,
      )
      .all() as Array<{ queue_priority: number; plan: string }>;
    expect(priorities.filter((row) => row.plan === "agency").every((row) => row.queue_priority === 0)).toBe(
      true,
    );
    expect(priorities.filter((row) => row.plan === "starter").every((row) => row.queue_priority === 1)).toBe(
      true,
    );
    expect(priorities.filter((row) => row.plan === "scout").every((row) => row.queue_priority === 2)).toBe(
      true,
    );
    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(createBatch.mock.calls[0]?.[0]).toHaveLength(88);
  });

  it("deduplicates duplicate cron delivery for the same window", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const watchlist = buildWatchlist(1);
    const scheduledTime = Date.parse("2026-06-23T04:00:00.000Z");
    const executionKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      scheduledTime,
      cron: "0 4 * * *",
    });

    const first = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey,
      pageBudget: 2,
      scheduledTime,
    });
    const second = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey,
      pageBudget: 2,
      scheduledTime,
    });

    const row = sqlite.prepare("SELECT COUNT(*) AS count, started_at FROM watchlist_run").get() as {
      count: number;
      started_at: string;
    };
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(row.count).toBe(1);
    expect(row.started_at).toBe(new Date(scheduledTime).toISOString());
  });

  it("coalesces later scheduled windows while a watchlist still has active scheduled work", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const watchlist = buildWatchlist(1);
    const firstSlot = Date.parse("2026-06-23T03:00:00.000Z");
    const secondSlot = Date.parse("2026-06-23T06:00:00.000Z");
    const thirdSlot = Date.parse("2026-06-23T09:00:00.000Z");

    const firstKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      scheduledTime: firstSlot,
      cron: "0 */3 * * *",
    });
    const secondKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      scheduledTime: secondSlot,
      cron: "0 */3 * * *",
    });
    const thirdKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      scheduledTime: thirdSlot,
      cron: "0 */3 * * *",
    });

    const first = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey: firstKey,
      pageBudget: 2,
      scheduledTime: firstSlot,
    });
    const second = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey: secondKey,
      pageBudget: 2,
      scheduledTime: secondSlot,
    });

    expect(second).toEqual({ runId: first.runId, created: false });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 1 });

    sqlite.prepare("UPDATE watchlist_run SET status = 'succeeded' WHERE id = ?").run(first.runId);
    const third = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey: thirdKey,
      pageBudget: 2,
      scheduledTime: thirdSlot,
    });

    expect(third.created).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 2 });
  });

  it("does not let stale legacy inline scheduled rows suppress fan-out insertion", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const watchlist = buildWatchlist(1);
    sqlite
      .prepare(
        `INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json, started_at, created_at, updated_at, queued_at, attempt_count)
         VALUES ('legacy-inline', ?, 'scheduled', 'running', 2, 0, '{}', '2026-06-23T00:00:00.000Z', '2026-06-23T00:00:00.000Z', '2026-06-23T00:00:00.000Z', NULL, 1)`,
      )
      .run(watchlist.id);

    const scheduledTime = Date.parse("2026-06-23T03:00:00.000Z");
    const created = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey: buildWatchlistExecutionIdempotencyKey({
        watchlistId: watchlist.id,
        triggerType: "scheduled",
        scheduledTime,
        cron: "0 */3 * * *",
      }),
      pageBudget: 2,
      scheduledTime,
    });

    expect(created.created).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 2 });
  });

  it("retries insertion when an active coalescing row finishes before fallback lookup", async () => {
    let insertAttempts = 0;
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                if (sql.includes("INSERT OR IGNORE INTO watchlist_run")) {
                  insertAttempts += 1;
                  return { meta: { changes: insertAttempts === 2 ? 1 : 0 } };
                }
                return { meta: { changes: 0 } };
              },
              async first<T>() {
                return null as T | null;
              },
              async all<T>() {
                return { results: [] as T[] };
              },
            };
          },
        };
      },
    };

    const result = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: "watch-race",
      triggerType: "scheduled",
      executionKey: "watchlist-run:scheduled:watch-race:0-3:2026-06-23T03-00-00-000Z",
      pageBudget: 2,
      scheduledTime: Date.parse("2026-06-23T03:00:00.000Z"),
    });

    expect(result.created).toBe(true);
    expect(insertAttempts).toBe(2);
  });

  it("reports a lost durable Workflow binding CAS instead of pretending it dispatched", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const watchlist = buildWatchlist(1);
    const ensured = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey: "binding-cas-test",
      pageBudget: 2,
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
    });
    sqlite.prepare("UPDATE watchlist_run SET status = 'succeeded' WHERE id = ?").run(ensured.runId);

    await expect(
      markOrchestratedRunDispatched({ DB: db } as never, {
        runId: ensured.runId,
        workflowInstanceId: "monitor-v1-binding-cas-test",
      }),
    ).resolves.toBe(false);
    expect(
      sqlite.prepare("SELECT workflow_instance_id FROM watchlist_run WHERE id = ?").get(ensured.runId),
    ).toEqual({ workflow_instance_id: null });
  });

  it("detects old queued scheduled runs that must block a manual overlap", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    sqlite
      .prepare(
        `INSERT INTO watchlist_run (
          id, watchlist_id, trigger_type, status, page_budget, summary_json,
          started_at, created_at, updated_at, idempotency_key, queued_at
        ) VALUES (?, ?, 'scheduled', 'pending', 2, '{}', ?, ?, ?, ?, ?)` ,
      )
      .run(
        "scheduled-old",
        "watch-1",
        "2026-06-23T04:00:00.000Z",
        "2026-06-23T04:00:00.000Z",
        "2026-06-23T04:00:00.000Z",
        "watchlist-run:scheduled:watch-1:adhoc:2026-06-23T04-00-00-000Z",
        "2026-06-23T04:00:00.000Z",
      );

    await expect(hasActiveScheduledWatchlistRun({ DB: db } as never, "watch-1")).resolves.toBe(true);
    sqlite.prepare("UPDATE watchlist_run SET status = 'succeeded' WHERE id = ?").run("scheduled-old");
    await expect(hasActiveScheduledWatchlistRun({ DB: db } as never, "watch-1")).resolves.toBe(false);
  });

  it("treats createBatch skipped IDs as duplicates, not dispatch failures", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const watchlist = buildWatchlist(1);
    const executionKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
    });
    const workflowInstanceId = await buildMonitoringWorkflowInstanceId(executionKey);
    const ensured = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey,
      pageBudget: 2,
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
    });

    const createBatch = vi.fn().mockResolvedValue([]);
    const result = await dispatchOrchestratedWatchlistJobsBatch(workflowEnv(db, createBatch), {
      jobs: [
        {
          watchlist,
          runId: ensured.runId,
          executionKey,
          workflowInstanceId,
          triggerType: "scheduled",
          scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
          cron: "0 4 * * *",
        },
      ],
    });

    expect(result.dispatched).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(result.outcomes).toEqual([{ runId: ensured.runId, status: "active" }]);
  });

  it.each(["errored", "terminated"] as const)(
    "restarts an omitted %s Workflow instance",
    async (status) => {
      const fixture = await seedDispatchFixture();
      const restart = vi.fn();
      const get = vi.fn(async () => ({
        status: async () => ({ status }),
        restart,
      }));
      const createBatch = vi.fn().mockResolvedValue([]);

      const result = await dispatchOrchestratedWatchlistJobsBatch(
        workflowEnv(fixture.db, createBatch, {
          MONITORING_WORKFLOW: { createBatch, create: vi.fn(), get },
        }),
        {
          jobs: [
            {
              watchlist: fixture.watchlist,
              runId: fixture.runId,
              executionKey: fixture.executionKey,
              workflowInstanceId: fixture.workflowInstanceId,
              triggerType: "scheduled",
              scheduledTime: fixture.scheduledTime,
              cron: "0 4 * * *",
            },
          ],
        },
      );

      expect(restart).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        dispatched: 1,
        duplicates: 0,
        failures: [],
        outcomes: [{ runId: fixture.runId, status: "restarted" }],
      });
    },
  );

  it("returns a failed outcome when omitted Workflow lookup fails", async () => {
    const fixture = await seedDispatchFixture();
    const createBatch = vi.fn().mockResolvedValue([]);
    const get = vi.fn().mockRejectedValue(new Error("instance lookup failed"));

    const result = await dispatchOrchestratedWatchlistJobsBatch(
      workflowEnv(fixture.db, createBatch, {
        MONITORING_WORKFLOW: { createBatch, create: vi.fn(), get },
      }),
      {
        jobs: [
          {
            watchlist: fixture.watchlist,
            runId: fixture.runId,
            executionKey: fixture.executionKey,
            workflowInstanceId: fixture.workflowInstanceId,
            triggerType: "scheduled",
            scheduledTime: fixture.scheduledTime,
          },
        ],
      },
    );

    expect(result.dispatched).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.failures).toEqual([{ runId: fixture.runId, error: "instance lookup failed" }]);
    expect(result.outcomes).toEqual([
      { runId: fixture.runId, status: "failed", error: "instance lookup failed" },
    ]);
  });

  it("returns a failed outcome when restarting an errored Workflow fails", async () => {
    const fixture = await seedDispatchFixture();
    const createBatch = vi.fn().mockResolvedValue([]);
    const get = vi.fn(async () => ({
      status: async () => ({ status: "errored" as const }),
      restart: vi.fn().mockRejectedValue(new Error("restart failed")),
    }));

    const result = await dispatchOrchestratedWatchlistJobsBatch(
      workflowEnv(fixture.db, createBatch, {
        MONITORING_WORKFLOW: { createBatch, create: vi.fn(), get },
      }),
      {
        jobs: [
          {
            watchlist: fixture.watchlist,
            runId: fixture.runId,
            executionKey: fixture.executionKey,
            workflowInstanceId: fixture.workflowInstanceId,
            triggerType: "scheduled",
            scheduledTime: fixture.scheduledTime,
          },
        ],
      },
    );

    expect(result.dispatched).toBe(0);
    expect(result.failures).toEqual([{ runId: fixture.runId, error: "restart failed" }]);
    expect(result.outcomes).toEqual([
      { runId: fixture.runId, status: "failed", error: "restart failed" },
    ]);
  });

  it("does not create an orphan Workflow when the durable run lost its owner", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const watchlist = buildWatchlist(1);
    const executionKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
    });
    const ensured = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey,
      pageBudget: 2,
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
    });
    sqlite.prepare("UPDATE watchlist_run SET status = 'succeeded' WHERE id = ?").run(ensured.runId);
    const createBatch = vi.fn().mockResolvedValue([{ id: "unexpected" }]);

    const result = await dispatchOrchestratedWatchlistJobsBatch(workflowEnv(db, createBatch), {
      jobs: [
        {
          watchlist,
          runId: ensured.runId,
          executionKey,
          workflowInstanceId: await buildMonitoringWorkflowInstanceId(executionKey),
          triggerType: "scheduled",
          scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
          cron: "0 4 * * *",
        },
      ],
    });

    expect(createBatch).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.failures).toEqual([
      {
        runId: ensured.runId,
        error: "The scheduled scan durable Workflow binding was lost before dispatch.",
      },
    ]);
  });

  it("records rate-limit batch failures as retryable dispatch failures", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const watchlist = buildWatchlist(1);
    const executionKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
    });
    const ensured = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: watchlist.id,
      triggerType: "scheduled",
      executionKey,
      pageBudget: 2,
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
    });
    const workflowInstanceId = await buildMonitoringWorkflowInstanceId(executionKey);
    const createBatch = vi.fn().mockRejectedValue(new Error("rate limit exceeded"));

    const result = await dispatchOrchestratedWatchlistJobsBatch(workflowEnv(db, createBatch), {
      jobs: [
        {
          watchlist,
          runId: ensured.runId,
          executionKey,
          workflowInstanceId,
          triggerType: "scheduled",
          scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
          cron: "0 4 * * *",
        },
      ],
    });

    expect(result.rateLimited).toBe(true);
    expect(result.failures).toHaveLength(1);
  });

  it("shadow mode validates scheduling without creating durable runs or workflows", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    sqlite.prepare("INSERT INTO user_plan (user_id, plan) VALUES (?, 'agency')").run("agency-owner");
    const watchlists = [buildWatchlist(1)];
    sqlite
      .prepare(
        `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, target_country, is_active, last_scanned_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')`,
      )
      .run(
        watchlists[0]!.id,
        watchlists[0]!.userId,
        watchlists[0]!.name,
        watchlists[0]!.targetType,
        watchlists[0]!.targetId,
        watchlists[0]!.targetFingerprint,
        watchlists[0]!.targetLabel,
      );

    const createBatch = vi.fn();
    const shadowResult = await scheduleWatchlistFanout(
      workflowEnv(db, createBatch, { MONITORING_FANOUT_MODE: "shadow" }),
      {
        watchlists,
        scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
        cron: "0 4 * * *",
        mode: "shadow",
      },
    );
    expect(shadowResult.shadowOnly).toBe(1);
    expect(createBatch).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 0 });

    const fanoutResult = await scheduleWatchlistFanout(workflowEnv(db, createBatch), {
      watchlists,
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
      mode: "fanout",
    });
    createBatch.mockResolvedValueOnce([{ id: "monitor-v1-test" }]);
    expect(fanoutResult.queued).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get()).toEqual({ count: 1 });
  });

  it("prevents stale processors from finalizing after a newer claim", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const runId = "run-1";
    sqlite
      .prepare(
        `INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json, started_at, created_at, updated_at, processing_token, processing_started_at, attempt_count)
         VALUES (?, 'watch-1', 'scheduled', 'running', 2, 0, '{}', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', 'stale-token', '2020-01-01T00:00:00.000Z', 1)`,
      )
      .run(runId);

    const claim = await claimOrchestratedWatchlistRun({ DB: db } as never, {
      runId,
      leaseMs: 1,
    });
    expect(claim.claimed).toBe(true);

    const staleFinalize = await finishOrchestratedWatchlistRun({ DB: db } as never, {
      runId,
      processingToken: "stale-token",
      status: "succeeded",
      pagesScanned: 1,
      summary: { events: 0 },
    });
    expect(staleFinalize).toBe(false);

    const freshFinalize = await finishOrchestratedWatchlistRun({ DB: db } as never, {
      runId,
      processingToken: claim.processingToken!,
      status: "succeeded",
      pagesScanned: 1,
      summary: { events: 0 },
    });
    expect(freshFinalize).toBe(true);
  });

  it("enforces atomic concurrency slots under parallel claim pressure", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const env = {
      DB: db,
      MONITORING_FANOUT_MAX_INFLIGHT: "8",
      MONITORING_SCHEDULED_BROWSER_MODE: "all",
    } as never;
    expect(resolveMonitoringFanoutMaxInflight(env)).toBe(8);

    for (let index = 0; index < 8; index += 1) {
      seedPendingOrchestratedRun(sqlite, `run-${index}`, {
        queuedAt: new Date(Date.parse("2026-06-23T04:00:00.000Z") + index * 1000).toISOString(),
      });
    }

    const claims = await Promise.all(
      Array.from({ length: 20 }, (_v, index) =>
        claimMonitoringConcurrencySlot(env, {
          runId: `run-${index}`,
          leaseMs: 60_000,
        }),
      ),
    );

    const successful = claims.filter((claim) => claim.claimed);
    expect(successful).toHaveLength(8);
    expect(await countHeldMonitoringConcurrencySlots(env)).toBe(8);

    const released = await releaseMonitoringConcurrencySlot(env, {
      token: successful[0]!.token!,
    });
    expect(released).toBe(true);

    sqlite.exec(`DELETE FROM watchlist_run`);
    seedPendingOrchestratedRun(sqlite, "run-reclaim", {
      queuedAt: "2026-06-23T05:00:00.000Z",
    });
    const reclaimed = await claimMonitoringConcurrencySlot(env, {
      runId: "run-reclaim",
      leaseMs: 60_000,
    });
    expect(reclaimed.claimed).toBe(true);
    expect(await countHeldMonitoringConcurrencySlots(env)).toBeLessThanOrEqual(8);

    const staleRelease = await releaseMonitoringConcurrencySlot(env, {
      token: successful[0]!.token!,
    });
    expect(staleRelease).toBe(false);
  });

  it("cancels pending orchestrated runs when inline rollback reconciliation runs", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    sqlite
      .prepare(
        `INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json, started_at, created_at, updated_at, attempt_count)
         VALUES ('run-pending', 'watch-1', 'scheduled', 'pending', 2, 0, '{}', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', 0)`,
      )
      .run();

    const result = await reconcileOrchestratedWatchlistRuns({ DB: db } as never, {
      mode: "inline",
    });
    expect(result.cancelled).toBe(1);
    const row = sqlite
      .prepare("SELECT status, error_code FROM watchlist_run WHERE id = 'run-pending'")
      .get() as { status: string; error_code: string };
    expect(row.status).toBe("skipped");
    expect(row.error_code).toBe("fanout_disabled");
  });

  it("does not cancel old pending backlog during fanout reconciliation", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    seedPendingOrchestratedRun(sqlite, "run-old-pending", {
      queuedAt: "2026-06-23T04:00:00.000Z",
    });

    const result = await reconcileOrchestratedWatchlistRuns(
      {
        DB: db,
        MONITORING_WORKFLOW: {
          create: vi.fn(),
          createBatch: vi.fn(async (batch: Array<{ id: string }>) => batch.map((item) => ({ id: item.id }))),
        },
        MONITORING_FANOUT_MODE: "fanout",
        MONITORING_FANOUT_GLOBAL: "1",
        MONITORING_SCHEDULED_BROWSER_MODE: "all",
        MONITORING_ORCHESTRATION_MAX_AGE_MS: "1",
      } as never,
      {
        mode: "fanout",
        leaseMs: 1,
      },
    );

    const row = sqlite
      .prepare("SELECT status, error_code FROM watchlist_run WHERE id = 'run-old-pending'")
      .get() as { status: string; error_code: string | null };
    expect(row).toEqual({ status: "pending", error_code: null });
    expect(result.cancelled).toBe(0);
    expect(result.redispatched).toBe(1);
  });

  it("does not count an active duplicate as redispatched during reconciliation", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    seedPendingOrchestratedRun(sqlite, "run-active-duplicate");
    const createBatch = vi.fn(async () => []);
    const get = vi.fn(async () => ({
      status: async () => ({ status: "running" as const }),
      restart: vi.fn(),
    }));

    const result = await reconcileOrchestratedWatchlistRuns(
      {
        DB: db,
        MONITORING_WORKFLOW: { create: vi.fn(), createBatch, get },
        MONITORING_FANOUT_MODE: "fanout",
        MONITORING_FANOUT_GLOBAL: "1",
        MONITORING_SCHEDULED_BROWSER_MODE: "all",
        MONITORING_ORCHESTRATION_MAX_AGE_MS: "1",
      } as never,
      { mode: "fanout", leaseMs: 1 },
    );

    expect(get).toHaveBeenCalledTimes(1);
    expect(result.redispatched).toBe(0);
    expect(result.cancelled).toBe(0);
    const row = sqlite
      .prepare("SELECT status, error_code FROM watchlist_run WHERE id = 'run-active-duplicate'")
      .get() as { status: string; error_code: string | null };
    expect(row).toEqual({ status: "pending", error_code: null });
  });

  it("still cancels old running jobs during fanout reconciliation", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    seedPendingOrchestratedRun(sqlite, "run-old-running", {
      queuedAt: "2026-06-23T04:00:00.000Z",
    });
    sqlite
      .prepare(
        `UPDATE watchlist_run
         SET status = 'running',
             processing_token = 'token-old',
             processing_started_at = '2026-06-23T04:00:00.000Z'
         WHERE id = 'run-old-running'`,
      )
      .run();

    const result = await reconcileOrchestratedWatchlistRuns(
      {
        DB: db,
        MONITORING_FANOUT_MODE: "fanout",
        MONITORING_FANOUT_GLOBAL: "1",
        MONITORING_SCHEDULED_BROWSER_MODE: "all",
        MONITORING_ORCHESTRATION_MAX_AGE_MS: "1",
      } as never,
      {
        mode: "fanout",
        leaseMs: 1,
      },
    );

    expect(result.cancelled).toBe(1);
    const row = sqlite
      .prepare("SELECT status, error_code FROM watchlist_run WHERE id = 'run-old-running'")
      .get() as { status: string; error_code: string | null };
    expect(row.status).toBe("skipped");
    expect(row.error_code).toBe("orchestration_stale");
  });
});

describe("monitoring fan-out drain simulation", () => {
  it("drains 75 jobs through a limit of 8 without exceeding held permits", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    const env = {
      DB: db,
      MONITORING_FANOUT_MAX_INFLIGHT: "8",
      MONITORING_SCHEDULED_BROWSER_MODE: "all",
    } as never;
    let maxHeld = 0;

    for (let index = 0; index < 75; index += 1) {
      sqlite.exec(`DELETE FROM watchlist_run`);
      seedPendingOrchestratedRun(sqlite, `run-${index}`, {
        queuedAt: new Date(Date.parse("2026-06-23T04:00:00.000Z") + index * 1000).toISOString(),
      });
      const claim = await claimMonitoringConcurrencySlot(env, {
        runId: `run-${index}`,
        leaseMs: 60_000,
      });
      if (!claim.claimed) {
        const held = await countHeldMonitoringConcurrencySlots(env);
        maxHeld = Math.max(maxHeld, held);
        const releaseCandidate = sqlite
          .prepare(
            "SELECT holder_token AS token FROM monitoring_concurrency_slot WHERE holder_run_id IS NOT NULL ORDER BY leased_at ASC LIMIT 1",
          )
          .get() as { token: string };
        await releaseMonitoringConcurrencySlot(env, { token: releaseCandidate.token });
        sqlite.exec(`DELETE FROM watchlist_run`);
        seedPendingOrchestratedRun(sqlite, `run-${index}`, {
          queuedAt: new Date(Date.parse("2026-06-23T04:00:00.000Z") + index * 1000).toISOString(),
        });
        const retry = await claimMonitoringConcurrencySlot(env, {
          runId: `run-${index}`,
          leaseMs: 60_000,
        });
        expect(retry.claimed).toBe(true);
      }
      maxHeld = Math.max(maxHeld, await countHeldMonitoringConcurrencySlots(env));
      expect(maxHeld).toBeLessThanOrEqual(8);
    }

    expect(maxHeld).toBeLessThanOrEqual(8);
  });
});
