import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { collectMonitoringOrchestrationMetrics } from "~/lib/monitoring-fanout.server";

const DAY_MS = 24 * 60 * 60 * 1000;

// Minimal D1 stub (mirrors tests/helpers/sqlite-d1.ts) that also supports
// prepare().all() without bind(), the way Cloudflare D1 does — the shared
// helper only exposes all()/first()/run() after bind().
function createLocalD1() {
  const sqlite = new DatabaseSync(":memory:");
  return {
    sqlite,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              async all<T>() {
                return { results: sqlite.prepare(sql).all(...bindings) as T[] };
              },
            };
          },
          async all<T>() {
            return { results: sqlite.prepare(sql).all() as T[] };
          },
        };
      },
    },
  };
}

function seedRun(
  sqlite: DatabaseSync,
  runId: string,
  startedAt: string,
) {
  sqlite.exec(`
    INSERT INTO watchlist_run (
      id, watchlist_id, trigger_type, status, page_budget, pages_scanned, summary_json,
      started_at, created_at, updated_at, idempotency_key, queued_at, attempt_count, queue_priority
    ) VALUES (
      '${runId}', 'watch-1', 'scheduled', 'pending', 2, 0, '{}',
      '${startedAt}', '${startedAt}', '${startedAt}',
      'watchlist-run:scheduled:watch-1:test:${runId}', '${startedAt}', 0, 2
    );
  `);
}

async function buildMetricsEnv() {
  const { db, sqlite } = createLocalD1();
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
      retry_after TEXT,
      queue_priority INTEGER NOT NULL DEFAULT 2
    );
  `);
  return { sqlite, env: { DB: db } as never };
}

// Regression test for the ISO-vs-SQLite datetime comparison bug (issue #2459):
// started_at is stored as ISO (…T…) while datetime('now','-2 days') emits a
// space-separated string, so string comparison pulled the entire cutoff
// calendar day into the window. The seeded timestamps are derived from the
// real clock because SQLite's datetime('now') reads the OS clock, not
// vi.setSystemTime — this keeps the test hermetic no matter when it runs.
describe("collectMonitoringOrchestrationMetrics 2-day window", () => {
  it("does not count a scheduled run older than the true 2-day cutoff", async () => {
    const { sqlite, env } = await buildMetricsEnv();
    // 1 hour before the true cutoff: outside the window, same calendar day.
    const startedAt = new Date(Date.now() - 2 * DAY_MS - 60 * 60 * 1000).toISOString();
    seedRun(sqlite, "run-outside", startedAt);

    const metrics = await collectMonitoringOrchestrationMetrics(env);

    expect(metrics.queued).toBe(0);
  });

  it("still counts a scheduled run inside the 2-day window", async () => {
    const { sqlite, env } = await buildMetricsEnv();
    const startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    seedRun(sqlite, "run-inside", startedAt);

    const metrics = await collectMonitoringOrchestrationMetrics(env);

    expect(metrics.queued).toBe(1);
  });
});
