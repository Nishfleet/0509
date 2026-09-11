import { readFileSync } from "node:fs";
import nodePath from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildMonitoringWorkflowInstanceId,
  FIRST_SCAN_MAX_ATTEMPTS,
} from "~/lib/monitoring-fanout.server";
import {
  firstWatchlistScanExecutionKey,
  runFirstWatchlistScanWorkflowJob,
} from "~/lib/first-watchlist-scan.server";
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

describe("monitoring workflow retry configuration", () => {
  it("caps the run-first-watchlist-scan step retries at FIRST_SCAN_MAX_ATTEMPTS - 1", () => {
    const source = readFileSync(
      nodePath.resolve(import.meta.dirname, "../workers/monitoring-workflow.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /FIRST_SCAN_MAX_ATTEMPTS,\s*\n\s*MONITORING_WORKFLOW_SCAN_TIMEOUT_MS,/,
    );

    const stepConfig = source.slice(
      source.indexOf('"run-first-watchlist-scan"'),
      source.indexOf("async () => {", source.indexOf('"run-first-watchlist-scan"')),
    );
    expect(stepConfig).toContain(`limit: FIRST_SCAN_MAX_ATTEMPTS - 1`);
    expect(stepConfig).not.toMatch(/limit: \d+/);
  });

  it("reports a first-scan run at the claim cap as owned or exhausted", async () => {
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

    const watchlistId = "watch-1";
    const runId = "run-first-scan-cap";
    const executionKey = firstWatchlistScanExecutionKey(watchlistId);
    const workflowInstanceId = await buildMonitoringWorkflowInstanceId(
      executionKey,
    );

    sqlite
      .prepare(
        `INSERT INTO watchlist_run (id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json, started_at, created_at, updated_at, idempotency_key, workflow_instance_id, attempt_count)
         VALUES (?, ?, 'manual', 'pending', 2, 0, '{}', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', '2026-06-23T04:00:00.000Z', ?, ?, ${FIRST_SCAN_MAX_ATTEMPTS})`,
      )
      .run(runId, watchlistId, executionKey, workflowInstanceId);

    await expect(
      runFirstWatchlistScanWorkflowJob({ DB: db } as never, {
        kind: "first_scan",
        runId,
        watchlistId,
        executionKey,
        workflowInstanceId,
        queuedAt: "2026-06-23T04:00:00.000Z",
      }),
    ).rejects.toThrow(/owned or exhausted/);
  });
});
