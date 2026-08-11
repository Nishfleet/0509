import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1 } from "./helpers/sqlite-d1";

function seedSchema(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
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
    INSERT INTO watchlist (
      id, user_id, name, target_type, target_id, target_fingerprint, target_label,
      is_active, created_at, updated_at
    ) VALUES
      ('watch-1', 'user-1', 'Boat watch', 'advertiser', 'target-1', 'fp-1', 'Boat Lifestyle',
       1, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'),
      ('watch-2', 'user-1', 'Noise watch', 'advertiser', 'target-2', 'fp-2', 'Noise',
       1, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'),
      ('watch-3', 'user-1', 'Scanned watch', 'advertiser', 'target-3', 'fp-3', 'Scanned',
       1, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'),
      ('watch-4', 'user-1', 'Paused watch', 'advertiser', 'target-4', 'fp-4', 'Paused',
       0, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z'),
      ('watch-other', 'user-2', 'Other watch', 'advertiser', 'target-5', 'fp-5', 'Other',
       1, '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
    UPDATE watchlist SET last_scanned_at = '2026-07-15T08:00:00.000Z' WHERE id = 'watch-3';
    INSERT INTO watchlist_run (
      id, watchlist_id, trigger_type, status, summary_json, started_at, created_at,
      updated_at, idempotency_key
    ) VALUES
      ('run-1', 'watch-1', 'manual', 'running', '{}', '2026-07-15T09:00:00.000Z',
       '2026-07-15T09:00:00.000Z', '2026-07-15T09:00:00.000Z',
       'watchlist-run:first-scan:watch-1'),
      ('run-2', 'watch-2', 'manual', 'pending', '{}', '2026-07-15T09:01:00.000Z',
       '2026-07-15T09:01:00.000Z', '2026-07-15T09:01:00.000Z',
       'watchlist-run:first-scan:watch-2'),
      ('run-2-old', 'watch-2', 'manual', 'failed', '{}', '2026-07-15T08:00:00.000Z',
       '2026-07-15T08:00:00.000Z', '2026-07-15T08:00:00.000Z',
       'watchlist-run:first-scan:watch-2-old'),
      ('run-4', 'watch-4', 'manual', 'pending', '{}', '2026-07-15T09:02:00.000Z',
       '2026-07-15T09:02:00.000Z', '2026-07-15T09:02:00.000Z',
       'watchlist-run:first-scan:watch-4'),
      ('run-other', 'watch-other', 'manual', 'running', '{}', '2026-07-15T09:03:00.000Z',
       '2026-07-15T09:03:00.000Z', '2026-07-15T09:03:00.000Z',
       'watchlist-run:first-scan:watch-other'),
      ('run-scheduled', 'watch-1', 'scheduled', 'pending', '{}', '2026-07-15T09:04:00.000Z',
       '2026-07-15T09:04:00.000Z', '2026-07-15T09:04:00.000Z',
       'watchlist-run:scheduled:watch-1');
  `);
}

function env(db: ReturnType<typeof createSqliteD1>["db"]) {
  return { DB: db } as never;
}

describe("listFirstScanRunStates", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the latest first-scan run state per unscanned active watchlist", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const { listFirstScanRunStates } = await import(
      "~/lib/data/watchlist-runs.server"
    );

    const states = await listFirstScanRunStates(env(harness.db), "user-1");

    expect(states).toEqual([
      { watchlistId: "watch-1", status: "running", errorCode: null },
      { watchlistId: "watch-2", status: "pending", errorCode: null },
    ]);
    harness.close();
  });

  it("excludes paused watchlists, scanned watchlists, and other workspaces", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    const { listFirstScanRunStates } = await import(
      "~/lib/data/watchlist-runs.server"
    );

    const states = await listFirstScanRunStates(env(harness.db), "user-1");
    const ids = states.map((state) => state.watchlistId);

    expect(ids).not.toContain("watch-3"); // has scan history
    expect(ids).not.toContain("watch-4"); // paused
    expect(ids).not.toContain("watch-other"); // another workspace
    harness.close();
  });

  it("returns the latest run, not a stale earlier attempt", async () => {
    const harness = createSqliteD1();
    seedSchema(harness.sqlite);
    harness.sqlite
      .prepare(
        `UPDATE watchlist_run SET status = 'failed', error_code = 'provider_unavailable'
         WHERE id = 'run-1'`,
      )
      .run();
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist_run (
           id, watchlist_id, trigger_type, status, summary_json, started_at,
           created_at, updated_at, idempotency_key
         ) VALUES (
           'run-1-latest', 'watch-1', 'manual', 'pending', '{}',
           '2026-07-15T10:00:00.000Z', '2026-07-15T10:00:00.000Z',
           '2026-07-15T10:00:00.000Z', 'watchlist-run:first-scan:watch-1'
         )`,
      )
      .run();
    const { listFirstScanRunStates } = await import(
      "~/lib/data/watchlist-runs.server"
    );

    const states = await listFirstScanRunStates(env(harness.db), "user-1");
    const watch1 = states.find((state) => state.watchlistId === "watch-1");

    expect(watch1).toEqual({
      watchlistId: "watch-1",
      status: "pending",
      errorCode: null,
    });
    harness.close();
  });
});
