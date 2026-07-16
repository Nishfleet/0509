import { describe, expect, it, vi } from "vitest";

import {
  buildWatchlistExecutionIdempotencyKey,
  claimOrchestratedWatchlistRun,
  finishOrchestratedWatchlistRun,
} from "~/lib/monitoring-fanout.server";
import { runWatchlist } from "~/lib/monitoring.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

vi.mock("~/lib/plan.server", () => ({
  PLAN_LIMITS: {
    agency: { monthlyProofCap: 1000 },
  },
  getUserPlan: vi.fn().mockResolvedValue("agency"),
}));

vi.mock("~/lib/data.server", () => ({
  createProofCapture: vi.fn(),
  createWatchlistRun: vi.fn(),
  deliverWatchlistAlerts: vi.fn(),
  finishWatchlistRun: vi.fn(),
  getWatchlist: vi.fn(),
  hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
  getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
}));

describe("orchestrated watchlist fencing", () => {
  it("prevents a stale processor token from finalizing after reclaim", async () => {
    const { db, sqlite } = createSqliteD1();
    sqlite.exec(`
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
    `);

    const runId = "run-fence";
    sqlite
      .prepare(
        `INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json, started_at, created_at, updated_at, processing_token, processing_started_at, attempt_count)
         VALUES (?, 'watch-1', 'scheduled', 'running', 2, 0, '{}', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', 'token-a', '2020-01-01T00:00:00.000Z', 1)`,
      )
      .run(runId);

    const processorA = "token-a";
    const reclaim = await claimOrchestratedWatchlistRun({ DB: db } as never, {
      runId,
      leaseMs: 1,
    });
    expect(reclaim.claimed).toBe(true);

    const staleFinalize = await finishOrchestratedWatchlistRun({ DB: db } as never, {
      runId,
      processingToken: processorA,
      status: "succeeded",
      pagesScanned: 2,
      summary: { proofCaptures: 1 },
    });
    expect(staleFinalize).toBe(false);

    const freshFinalize = await finishOrchestratedWatchlistRun({ DB: db } as never, {
      runId,
      processingToken: reclaim.processingToken!,
      status: "succeeded",
      pagesScanned: 2,
      summary: { proofCaptures: 1 },
    });
    expect(freshFinalize).toBe(true);

    const executionKey = buildWatchlistExecutionIdempotencyKey({
      watchlistId: "watch-1",
      triggerType: "scheduled",
      scheduledTime: Date.parse("2026-06-23T04:00:00.000Z"),
      cron: "0 4 * * *",
    });
    expect(executionKey).toContain("watch-1");
  });

  it("rejects a reclaimed worker before it can persist scan effects", async () => {
    const { db, sqlite } = createSqliteD1();
    sqlite.exec(`
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
      INSERT INTO watchlist_run (
        id, watchlist_id, trigger_type, status, page_budget, summary_json,
        started_at, created_at, updated_at, attempt_count
      ) VALUES (
        'run-stale-effects', 'watch-1', 'manual', 'pending', 2, '{}',
        '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z',
        '2026-07-15T00:00:00.000Z', 0
      );
    `);
    const firstClaim = await claimOrchestratedWatchlistRun({ DB: db } as never, {
      runId: "run-stale-effects",
      leaseMs: 60_000,
    });
    expect(firstClaim.claimed).toBe(true);

    const scan = vi.fn(async () => {
      sqlite
        .prepare(
          "UPDATE watchlist_run SET processing_started_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
        )
        .run("run-stale-effects");
      const replacement = await claimOrchestratedWatchlistRun({ DB: db } as never, {
        runId: "run-stale-effects",
        leaseMs: 1,
      });
      expect(replacement.claimed).toBe(true);
      return { ads: [], pagesScanned: 1, degraded: false };
    });

    await expect(
      runWatchlist(
        { DB: db } as never,
        {
          id: "watch-1",
          userId: "user-1",
          name: "Competitor",
          targetType: "advertiser",
          targetId: "target-1",
          targetFingerprint: "fp-1",
          targetLabel: "Competitor",
          targetCountry: "IN",
          isActive: true,
          lastScannedAt: null,
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:00:00.000Z",
        },
        "manual",
        scan,
        {
          existingRunId: "run-stale-effects",
          orchestrationToken: firstClaim.processingToken!,
        },
      ),
    ).rejects.toThrow(/stale orchestrated watchlist run token/i);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT status, attempt_count FROM watchlist_run").get()).toEqual({
      status: "running",
      attempt_count: 2,
    });
  });
});
