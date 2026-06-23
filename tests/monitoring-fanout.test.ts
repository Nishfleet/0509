import { describe, expect, it, vi } from "vitest";

import {
  buildWatchlistExecutionIdempotencyKey,
  claimOrchestratedWatchlistRun,
  countActiveOrchestratedRuns,
  ensureOrchestratedWatchlistRun,
  finishOrchestratedWatchlistRun,
  resolveMonitoringFanoutMaxInflight,
  scheduleWatchlistFanout,
} from "~/lib/monitoring-fanout.server";
import type { WatchlistRecord } from "~/lib/types";
import { createSqliteD1 } from "./helpers/sqlite-d1";

vi.mock("~/lib/plan.server", () => ({
  getUserPlan: vi.fn().mockResolvedValue("agency"),
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
      plan TEXT NOT NULL
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
      retry_after TEXT
    );
    CREATE UNIQUE INDEX idx_watchlist_run_idempotency_key
      ON watchlist_run(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
}

describe("monitoring fan-out scheduling (sqlite)", () => {
  it("schedules 75 eligible watchlists with one logical run each", async () => {
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

    const workflowCreate = vi.fn().mockResolvedValue({ id: "wf" });
    const env = {
      DB: db,
      MONITORING_WORKFLOW: { create: workflowCreate },
      MONITORING_FANOUT_MODE: "fanout",
    } as never;
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
    expect(workflowCreate).toHaveBeenCalledTimes(75);
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

    const row = sqlite.prepare("SELECT COUNT(*) AS count FROM watchlist_run").get() as { count: number };
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(row.count).toBe(1);
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

  it("respects configured max in-flight concurrency", async () => {
    const { db, sqlite } = createSqliteD1();
    await seedFanoutSchema(sqlite);
    sqlite
      .prepare(
        `INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json, started_at, created_at, updated_at, attempt_count)
         VALUES ('run-1', 'watch-1', 'scheduled', 'running', 2, 0, '{}', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', 1)`,
      )
      .run();

    const env = { DB: db, MONITORING_FANOUT_MAX_INFLIGHT: "1" } as never;
    expect(resolveMonitoringFanoutMaxInflight(env)).toBe(1);
    expect(await countActiveOrchestratedRuns(env)).toBe(1);
  });
});
