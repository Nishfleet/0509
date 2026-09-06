import { describe, expect, it } from "vitest";

import {
  claimMonitoringConcurrencySlot,
  computeEffectiveQueuePriority,
  compareQueuedRuns,
  MONITORING_QUEUE_AGING_INTERVAL_MS,
  selectRankedEligibleOrchestratedRuns,
} from "~/lib/monitoring-fanout.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";
import { seedPendingOrchestratedRun } from "./helpers/monitoring-queue-seed";

async function seedMixedFleetSchema(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
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

describe("monitoring queue priority", () => {
  it("ranks agency ahead of starter and scout at equal age", () => {
    const now = Date.parse("2026-06-24T04:00:00.000Z");
    const agency = {
      id: "a",
      watchlist_id: "w1",
      queue_priority: 0,
      queued_at: "2026-06-24T03:00:00.000Z",
      started_at: "2026-06-24T03:00:00.000Z",
      user_id: "u1",
      plan: "agency",
      effectivePriority: computeEffectiveQueuePriority(0, "2026-06-24T03:00:00.000Z", now),
    };
    const starter = {
      ...agency,
      id: "s",
      queue_priority: 1,
      effectivePriority: computeEffectiveQueuePriority(1, "2026-06-24T03:00:00.000Z", now),
      plan: "starter",
    };
    expect(compareQueuedRuns(agency, starter)).toBeLessThan(0);
  });

  it("ages lower-priority runs after the configured interval", () => {
    const queuedAt = "2026-06-24T00:00:00.000Z";
    const beforeBoost = computeEffectiveQueuePriority(
      2,
      queuedAt,
      Date.parse(queuedAt) + MONITORING_QUEUE_AGING_INTERVAL_MS - 1,
    );
    const afterBoost = computeEffectiveQueuePriority(
      2,
      queuedAt,
      Date.parse(queuedAt) + MONITORING_QUEUE_AGING_INTERVAL_MS,
    );
    expect(beforeBoost).toBe(2);
    expect(afterBoost).toBe(1);
  });

  it("ranks a mixed 75/10/3 fleet with agency ahead under concurrency pressure", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedMixedFleetSchema(sqlite);
    const monday = "2026-06-22T06:00:00.000Z";

    for (let index = 0; index < 75; index += 1) {
      seedPendingOrchestratedRun(sqlite, `agency-${index}`, {
        watchlistId: `watch-agency-${index}`,
        userId: "agency-owner",
        plan: "agency",
        queuePriority: 0,
        queuedAt: new Date(Date.parse(monday) + index * 1000).toISOString(),
      });
    }
    for (let index = 0; index < 10; index += 1) {
      seedPendingOrchestratedRun(sqlite, `starter-${index}`, {
        watchlistId: `watch-starter-${index}`,
        userId: "starter-owner",
        plan: "starter",
        queuePriority: 1,
        queuedAt: new Date(Date.parse(monday) + 75_000 + index * 1000).toISOString(),
      });
    }
    for (let index = 0; index < 3; index += 1) {
      seedPendingOrchestratedRun(sqlite, `scout-${index}`, {
        watchlistId: `watch-scout-${index}`,
        userId: "scout-owner",
        plan: "scout",
        queuePriority: 2,
        queuedAt: new Date(Date.parse(monday) + 85_000 + index * 1000).toISOString(),
      });
    }

    const ranked = await selectRankedEligibleOrchestratedRuns(
      { DB: db, MONITORING_SCHEDULED_BROWSER_MODE: "all" } as never,
      monday,
    );
    expect(ranked).toHaveLength(88);
    expect(ranked.slice(0, 8).every((row) => row.plan === "agency")).toBe(true);
    expect(ranked[75]?.plan).toBe("starter");
    expect(ranked[85]?.plan).toBe("scout");

    const env = {
      DB: db,
      MONITORING_FANOUT_MAX_INFLIGHT: "8",
      MONITORING_SCHEDULED_BROWSER_MODE: "all",
    } as never;
    const claims = await Promise.all(
      ranked.slice(0, 8).map((row) =>
        claimMonitoringConcurrencySlot(env, {
          runId: row.id,
          leaseMs: 60_000,
        }),
      ),
    );
    expect(claims.every((claim) => claim.claimed)).toBe(true);
  });

  it("keeps already queued Scout rows eligible even when the stored slot predates six-hour cadence", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedMixedFleetSchema(sqlite);
    seedPendingOrchestratedRun(sqlite, "scout-old-slot", {
      watchlistId: "watch-scout-old-slot",
      userId: "scout-owner",
      plan: "scout",
      queuePriority: 2,
      queuedAt: "2026-06-23T04:00:00.000Z",
    });

    const ranked = await selectRankedEligibleOrchestratedRuns(
      { DB: db, MONITORING_SCHEDULED_BROWSER_MODE: "all" } as never,
      "2026-06-23T06:00:00.000Z",
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ id: "scout-old-slot", plan: "scout" });
  });
});
