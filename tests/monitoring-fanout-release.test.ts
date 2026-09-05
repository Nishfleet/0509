import { describe, expect, it, vi } from "vitest";

import {
  MONITORING_CONCURRENCY_SLOT_CAPACITY,
  MONITORING_LEASE_SAFETY_MARGIN_MS,
  MONITORING_WORKFLOW_SCAN_TIMEOUT_MS,
  buildMonitoringWorkflowCapacitySleepStepName,
  buildMonitoringWorkflowConcurrencyStepName,
  buildMonitoringWorkflowInstanceId,
  buildWatchlistExecutionIdempotencyKey,
  claimMonitoringConcurrencySlot,
  countHeldMonitoringConcurrencySlots,
  dispatchOrchestratedWatchlistJobsBatch,
  ensureOrchestratedWatchlistRun,
  isFanoutEnabledForWorkspace,
  isMonitoringWorkflowBindingAvailable,
  renewMonitoringConcurrencySlot,
  renewOrchestratedWatchlistRunLease,
  releaseMonitoringConcurrencySlot,
  resolveEffectiveMonitoringFanoutMaxInflight,
  resolveMonitoringConcurrencySlotLeaseMs,
  resolveMonitoringFanoutMode,
  resolveMonitoringOrchestrationLeaseMs,
  scheduleWatchlistFanout,
} from "~/lib/monitoring-fanout.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";
import { seedPendingOrchestratedRun } from "./helpers/monitoring-queue-seed";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn().mockResolvedValue("agency"),
}));

async function seedSlotSchema(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
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
    CREATE TABLE monitoring_concurrency_slot (
      slot_index INTEGER PRIMARY KEY,
      holder_run_id TEXT,
      holder_token TEXT,
      leased_at TEXT
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
  `);
  const insert = sqlite.prepare(
    "INSERT OR IGNORE INTO monitoring_concurrency_slot (slot_index) VALUES (?)",
  );
  for (let slot = 0; slot < MONITORING_CONCURRENCY_SLOT_CAPACITY; slot += 1) {
    insert.run(slot);
  }
}

describe("monitoring fan-out release safeguards", () => {
  it("keeps workflow step timeout within Cloudflare's documented cap", () => {
    expect(MONITORING_WORKFLOW_SCAN_TIMEOUT_MS).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it("clamps configured concurrency to seeded slot capacity", () => {
    expect(resolveEffectiveMonitoringFanoutMaxInflight({} as never)).toBe(8);
    expect(
      resolveEffectiveMonitoringFanoutMaxInflight({ MONITORING_FANOUT_MAX_INFLIGHT: "65" } as never),
    ).toBe(MONITORING_CONCURRENCY_SLOT_CAPACITY);
    expect(
      resolveEffectiveMonitoringFanoutMaxInflight({ MONITORING_FANOUT_MAX_INFLIGHT: "0" } as never),
    ).toBe(8);
    expect(
      resolveEffectiveMonitoringFanoutMaxInflight({ MONITORING_FANOUT_MAX_INFLIGHT: "-3" } as never),
    ).toBe(8);
    expect(
      resolveEffectiveMonitoringFanoutMaxInflight({ MONITORING_FANOUT_MAX_INFLIGHT: "8.5" } as never),
    ).toBe(8);
    expect(
      resolveEffectiveMonitoringFanoutMaxInflight({ MONITORING_FANOUT_MAX_INFLIGHT: "bogus" } as never),
    ).toBe(8);
    expect(
      resolveEffectiveMonitoringFanoutMaxInflight({ MONITORING_FANOUT_MAX_INFLIGHT: "64" } as never),
    ).toBe(64);
  });

  it("never allows more than the effective maximum held slots under parallel pressure", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedSlotSchema(sqlite);
    const env = {
      DB: db,
      MONITORING_FANOUT_MAX_INFLIGHT: "65",
      MONITORING_SCHEDULED_BROWSER_MODE: "all",
    } as never;
    const effective = resolveEffectiveMonitoringFanoutMaxInflight(env);
    for (let index = 0; index < effective; index += 1) {
      seedPendingOrchestratedRun(sqlite, `run-${index}`, {
        queuedAt: new Date(Date.parse("2026-06-23T04:00:00.000Z") + index * 1000).toISOString(),
      });
    }
    const claims = await Promise.all(
      Array.from({ length: effective }, (_v, index) =>
        claimMonitoringConcurrencySlot(env, { runId: `run-${index}`, leaseMs: 60_000 }),
      ),
    );
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(effective);
  });

  it("clamps leases shorter than scan timeout plus safety margin", () => {
    const shortLease = resolveMonitoringOrchestrationLeaseMs({
      MONITORING_ORCHESTRATION_LEASE_MS: "1000",
    } as never);
    const minimum = MONITORING_WORKFLOW_SCAN_TIMEOUT_MS + MONITORING_LEASE_SAFETY_MARGIN_MS;
    expect(shortLease).toBe(minimum);
    expect(
      resolveMonitoringConcurrencySlotLeaseMs({
        MONITORING_CONCURRENCY_SLOT_LEASE_MS: String(minimum),
      } as never),
    ).toBe(minimum);
  });

  it("rejects stale token lease renewal and release", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedSlotSchema(sqlite);
    seedPendingOrchestratedRun(sqlite, "run-1");
    const env = {
      DB: db,
      MONITORING_FANOUT_MAX_INFLIGHT: "1",
      MONITORING_SCHEDULED_BROWSER_MODE: "all",
    } as never;
    const claim = await claimMonitoringConcurrencySlot(env, { runId: "run-1", leaseMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const token = claim.token!;

    expect(await renewMonitoringConcurrencySlot(env, { token: "stale-token" })).toBe(false);

    sqlite
      .prepare(
        `UPDATE watchlist_run
         SET status = 'running',
             processing_token = ?,
             processing_started_at = '2026-06-23T04:00:00.000Z',
             attempt_count = 1
         WHERE id = 'run-1'`,
      )
      .run(token);

    expect(
      await renewOrchestratedWatchlistRunLease(env, {
        runId: "run-1",
        processingToken: "stale-token",
      }),
    ).toBe(false);
    expect(
      await renewOrchestratedWatchlistRunLease(env, {
        runId: "run-1",
        processingToken: token,
      }),
    ).toBe(true);
  });

  it("shares the configured cap with interactive first/manual runs", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedSlotSchema(sqlite);
    const env = {
      DB: db,
      MONITORING_FANOUT_MAX_INFLIGHT: "1",
      MONITORING_SCHEDULED_BROWSER_MODE: "all",
    } as never;

    const first = await claimMonitoringConcurrencySlot(env, {
      runId: "first-scan-run",
      mode: "interactive",
      leaseMs: 60_000,
    });
    expect(first.claimed).toBe(true);

    const manualWhileHeld = await claimMonitoringConcurrencySlot(env, {
      runId: "manual-refresh-run",
      mode: "interactive",
      leaseMs: 60_000,
    });
    expect(manualWhileHeld.claimed).toBe(false);

    await expect(countHeldMonitoringConcurrencySlots(env)).resolves.toBe(1);

    expect(await releaseMonitoringConcurrencySlot(env, { token: first.token! })).toBe(true);
    const manualAfterRelease = await claimMonitoringConcurrencySlot(env, {
      runId: "manual-refresh-run",
      mode: "interactive",
      leaseMs: 60_000,
    });
    expect(manualAfterRelease.claimed).toBe(true);
    expect(await releaseMonitoringConcurrencySlot(env, { token: manualAfterRelease.token! })).toBe(true);
    await expect(countHeldMonitoringConcurrencySlots(env)).resolves.toBe(0);
  });

  it("lets a crashed interactive run reclaim its expired lease without duplicating a live holder", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedSlotSchema(sqlite);
    const env = {
      DB: db,
      MONITORING_FANOUT_MAX_INFLIGHT: "1",
      MONITORING_SCHEDULED_BROWSER_MODE: "all",
    } as never;

    const first = await claimMonitoringConcurrencySlot(env, {
      runId: "crashed-interactive-run",
      mode: "interactive",
      leaseMs: 60_000,
    });
    expect(first.claimed).toBe(true);
    sqlite
      .prepare("UPDATE monitoring_concurrency_slot SET leased_at = ? WHERE holder_token = ?")
      .run("2020-01-01T00:00:00.000Z", first.token!);

    const reclaimed = await claimMonitoringConcurrencySlot(env, {
      runId: "crashed-interactive-run",
      mode: "interactive",
      leaseMs: 60_000,
    });
    expect(reclaimed.claimed).toBe(true);
    expect(reclaimed.token).not.toBe(first.token);
    expect(await releaseMonitoringConcurrencySlot(env, { token: reclaimed.token! })).toBe(true);
  });

  it("fails loudly for explicit fan-out when the workflow binding is missing", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedSlotSchema(sqlite);
    const executionKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: "watch-1",
      triggerType: "scheduled",
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
    });
    const ensured = await ensureOrchestratedWatchlistRun({ DB: db } as never, {
      watchlistId: "watch-1",
      triggerType: "scheduled",
      executionKey,
      pageBudget: 2,
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
    });
    const workflowInstanceId = await buildMonitoringWorkflowInstanceId(executionKey);
    const result = await dispatchOrchestratedWatchlistJobsBatch(
      { DB: db, MONITORING_FANOUT_MODE: "fanout" } as never,
      {
        jobs: [
          {
            watchlist: {
              id: "watch-1",
              userId: "agency-owner",
              name: "watch",
              targetType: "advertiser",
              targetId: "brand",
              targetFingerprint: "fp",
              targetLabel: "brand",
              targetCountry: null,
              isActive: true,
              lastScannedAt: null,
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z",
            },
            runId: ensured.runId,
            executionKey,
            workflowInstanceId,
            triggerType: "scheduled",
            scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
            cron: "0 4 * * *",
          },
        ],
      },
    );

    expect(result.bindingMissing).toBe(true);
    expect(result.failures).toHaveLength(1);
    expect(result.dispatched).toBe(0);
  });

  it("keeps explicit fan-out mode even when the workflow binding is absent", () => {
    expect(resolveMonitoringFanoutMode({ MONITORING_FANOUT_MODE: "fanout" } as never)).toBe("fanout");
    expect(isMonitoringWorkflowBindingAvailable({} as never)).toBe(false);
    expect(
      isFanoutEnabledForWorkspace(
        {
          MONITORING_FANOUT_MODE: "fanout",
          MONITORING_FANOUT_ALLOWLIST: "agency-owner",
        } as never,
        "agency-owner",
      ),
    ).toBe(true);
  });

  it("persists workflow_binding_missing on scheduled fan-out without a binding", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedSlotSchema(sqlite);
    sqlite.prepare("INSERT INTO user_plan (user_id, plan) VALUES (?, 'agency')").run("agency-owner");
    sqlite
      .prepare(
        `INSERT INTO watchlist (id, user_id, name, target_type, target_id, target_fingerprint, target_label, target_country, is_active, last_scanned_at, created_at, updated_at)
         VALUES ('watch-1', 'agency-owner', 'watch', 'advertiser', 'brand', 'fp', 'brand', NULL, 1, NULL, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')`,
      )
      .run();

    const result = await scheduleWatchlistFanout(
      {
        DB: db,
        MONITORING_FANOUT_MODE: "fanout",
        MONITORING_FANOUT_ALLOWLIST: "agency-owner",
        MONITORING_SCHEDULED_BROWSER_MODE: "all",
      } as never,
      {
        watchlists: [
          {
            id: "watch-1",
            userId: "agency-owner",
            name: "watch",
            targetType: "advertiser",
            targetId: "brand",
            targetFingerprint: "fp",
            targetLabel: "brand",
            targetCountry: null,
            isActive: true,
            lastScannedAt: null,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
        scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
        cron: "0 4 * * *",
        mode: "fanout",
      },
    );

    expect(result.queued).toBe(1);
    expect(result.dispatchFailures).toBe(1);
    const row = sqlite
      .prepare("SELECT error_code, status FROM watchlist_run LIMIT 1")
      .get() as { error_code: string; status: string };
    expect(row.status).toBe("pending");
    expect(row.error_code).toBe("workflow_binding_missing");
  });

  it("uses deterministic workflow step names for replay", () => {
    const names = Array.from({ length: 5 }, (_v, index) => ({
      claim: buildMonitoringWorkflowConcurrencyStepName(index),
      sleep: buildMonitoringWorkflowCapacitySleepStepName(index),
    }));
    expect(names).toEqual([
      { claim: "claim-monitoring-concurrency-0", sleep: "wait-monitoring-capacity-0" },
      { claim: "claim-monitoring-concurrency-1", sleep: "wait-monitoring-capacity-1" },
      { claim: "claim-monitoring-concurrency-2", sleep: "wait-monitoring-capacity-2" },
      { claim: "claim-monitoring-concurrency-3", sleep: "wait-monitoring-capacity-3" },
      { claim: "claim-monitoring-concurrency-4", sleep: "wait-monitoring-capacity-4" },
    ]);
  });

  it("generates valid workflow IDs for 1000 logical keys", async () => {
    for (let index = 0; index < 1000; index += 1) {
      const executionKey = buildWatchlistExecutionIdempotencyKey({
        watchlistId: `watch-${index}`,
        triggerType: "scheduled",
        scheduledTime: Date.parse("2026-06-23T04:00:00.000Z") + index,
        cron: "0 4 * * *",
      });
      const workflowId = await buildMonitoringWorkflowInstanceId(executionKey);
      expect(workflowId.length).toBeLessThanOrEqual(100);
      expect(workflowId).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/);
    }
  });
});
