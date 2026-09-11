import { afterEach, describe, expect, it } from "vitest";

import {
  buildWatchlistGrantReconcileStatements,
  deactivateWatchlistsBeyondPlanLimit,
  reactivateWatchlistsUpToPlanLimit,
} from "~/lib/data/watchlist-plan-reconcile.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

function seedSchema(sqlite: ReturnType<typeof createSqliteD1>["sqlite"]) {
  sqlite.exec(`
    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      paused_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE web_mention_target (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);
}

function activeWatchlistIds(
  sqlite: ReturnType<typeof createSqliteD1>["sqlite"],
  userId: string,
) {
  return sqlite
    .prepare("SELECT id FROM watchlist WHERE user_id = ? AND is_active = 1 ORDER BY id")
    .all(userId)
    .map((row) => (row as { id: string }).id);
}

describe("watchlist plan-limit reconcile", () => {
  const fixtures: Array<ReturnType<typeof createSqliteD1>> = [];

  afterEach(() => {
    while (fixtures.length) fixtures.pop()?.close();
  });

  function openEnv() {
    const harness = createSqliteD1();
    fixtures.push(harness);
    seedSchema(harness.sqlite);
    return { harness, env: { DB: harness.db } as never };
  }

  it("resumes the newest-created paused watchlist when a mass pause tied updated_at", async () => {
    const { harness, env } = openEnv();
    harness.sqlite.exec(`
      INSERT INTO watchlist (id, user_id, is_active, paused_reason, created_at, updated_at)
      VALUES
        ('wl-1', 'user-1', 1, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('wl-2', 'user-1', 1, NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
        ('wl-3', 'user-1', 1, NULL, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
        ('wl-4', 'user-1', 1, NULL, '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z');
    `);

    // One UPDATE stamps wl-1..wl-3 with the same paused updated_at.
    await expect(deactivateWatchlistsBeyondPlanLimit(env, "user-1", 1)).resolves.toBe(3);
    expect(activeWatchlistIds(harness.sqlite, "user-1")).toEqual(["wl-4"]);
    const paused = harness.sqlite
      .prepare("SELECT DISTINCT updated_at FROM watchlist WHERE user_id = 'user-1' AND is_active = 0")
      .all();
    expect(paused).toHaveLength(1);

    // Resubscribing to 2 watchlists frees one slot; the newest-created paused
    // row must win the tie, not an arbitrary (rowid-ordered) oldest one.
    await expect(reactivateWatchlistsUpToPlanLimit(env, "user-1", 2)).resolves.toBe(1);
    expect(activeWatchlistIds(harness.sqlite, "user-1")).toEqual(["wl-3", "wl-4"]);
  });

  it("grant reconcile resumes the newest-created paused watchlist on an updated_at tie", async () => {
    const { harness } = openEnv();
    // wl-2/3/4 were mass-paused (identical updated_at); wl-3 and wl-4 also tie
    // on created_at so the id tiebreaker decides between them.
    harness.sqlite.exec(`
      INSERT INTO watchlist (id, user_id, is_active, paused_reason, created_at, updated_at)
      VALUES
        ('wl-1', 'user-1', 1, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('wl-2', 'user-1', 0, 'plan_limit', '2026-01-02T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
        ('wl-3', 'user-1', 0, 'plan_limit', '2026-01-03T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
        ('wl-4', 'user-1', 0, 'plan_limit', '2026-01-03T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
    `);

    const statements = buildWatchlistGrantReconcileStatements(
      harness.db as never,
      "user-1",
      2,
      "2026-06-02T00:00:00.000Z",
    );
    await harness.db.batch(statements);

    // 1 active of 2 allowed -> exactly one paused row resumes: wl-4 wins the
    // created_at tie via id DESC.
    expect(activeWatchlistIds(harness.sqlite, "user-1")).toEqual(["wl-1", "wl-4"]);
  });
});
