import { describe, expect, it } from "vitest";

import { queryAll, queryIn } from "~/lib/data/d1.server";
import { D1_MAX_BOUND_PARAMS } from "~/lib/d1-chunk.server";

import { appEnv, db, ISO_T0, seedWatchlistWithRun, uid } from "./fixtures";

/**
 * D1 rejects any statement carrying more than 100 bound parameters. Every
 * arbitrary-length `IN (?, ?, …)` in the data layer therefore goes through
 * `queryIn`, which chunks at `D1_MAX_BOUND_PARAMS`.
 *
 * That contract is unverifiable against a mock: a fake binding will happily
 * accept 250 parameters and return rows, so a chunking regression — or a
 * `queryIn` bypass added by a later change — passes every existing suite and
 * fails only in production, on the first customer with a large watchlist.
 *
 * These tests assert the limit from the runtime itself, then assert that
 * `queryIn` survives it and returns the complete result set.
 */

async function seedEvents(watchlistId: string, runId: string, count: number) {
  const statement = db().prepare(
    `INSERT INTO watch_event (
       id, watchlist_id, run_id, event_type, status, importance_score,
       title, summary, metadata_json, created_at
     ) VALUES (?, ?, ?, 'ad_new', 'confirmed', 0, ?, ?, '{}', ?)`,
  );
  // Storage is isolated per test FILE, not per test, so ids must be unique
  // across every seed call in this file.
  const batch = uid("bulk");
  const ids = Array.from(
    { length: count },
    (_, index) => `watch_event_${batch}_${index.toString().padStart(4, "0")}`,
  );
  await db().batch(
    ids.map((id) =>
      statement.bind(id, watchlistId, runId, `Title ${id}`, `Summary ${id}`, ISO_T0),
    ),
  );
  return ids;
}

describe("D1's bound-parameter cap", () => {
  it("rejects a statement with more than 100 bound parameters", async () => {
    // The number `queryIn` exists to defend. If a future D1 raises or removes
    // the cap, this test is how the fleet finds out — not by guessing.
    const placeholders = Array.from({ length: 101 }, () => "?").join(", ");
    await expect(
      db()
        .prepare(`SELECT id FROM watch_event WHERE id IN (${placeholders})`)
        .bind(...Array.from({ length: 101 }, (_, index) => `id_${index}`))
        .all(),
    ).rejects.toThrow(/too many SQL variables/i);
  });

  it("accepts a statement at exactly 100 bound parameters", async () => {
    const placeholders = Array.from({ length: 100 }, () => "?").join(", ");
    const result = await db()
      .prepare(`SELECT id FROM watch_event WHERE id IN (${placeholders})`)
      .bind(...Array.from({ length: 100 }, (_, index) => `id_${index}`))
      .all();
    expect(result.success).toBe(true);
  });

  it("keeps D1_MAX_BOUND_PARAMS strictly under the runtime's own limit", () => {
    // Headroom for the prefix/suffix bindings `queryIn` adds around the IN list.
    expect(D1_MAX_BOUND_PARAMS).toBeLessThan(100);
  });
});

describe("queryIn against real D1", () => {
  it("returns every row for a value list far past the cap", async () => {
    const { watchlistId, runId } = await seedWatchlistWithRun();
    const ids = await seedEvents(watchlistId, runId, 250);

    const rows = await queryIn<{ id: string }>(appEnv, {
      buildSql: (placeholders) =>
        `SELECT id FROM watch_event WHERE id IN (${placeholders})`,
      values: ids,
    });

    // Not just "more than a chunk" — exactly all of them. A tail-dropping
    // off-by-one in the chunker is the failure this catches.
    expect(rows).toHaveLength(250);
    expect(new Set(rows.map((row) => row.id))).toEqual(new Set(ids));
  });

  it("still fits under the cap when prefix and suffix bindings are added", async () => {
    const { watchlistId, runId } = await seedWatchlistWithRun();
    const ids = await seedEvents(watchlistId, runId, 200);

    const rows = await queryIn<{ id: string }>(appEnv, {
      buildSql: (placeholders) =>
        `SELECT id FROM watch_event
         WHERE watchlist_id = ?
           AND id IN (${placeholders})
           AND created_at >= ?
         ORDER BY id ASC`,
      prefix: [watchlistId],
      suffix: [ISO_T0],
      values: ids,
    });

    expect(rows).toHaveLength(200);
  });

  it("issues no query at all for an empty value list", async () => {
    // An empty IN list is not valid SQL; the guard must short-circuit rather
    // than build `IN ()`.
    const rows = await queryIn<{ id: string }>(appEnv, {
      buildSql: (placeholders) =>
        `SELECT id FROM watch_event WHERE id IN (${placeholders})`,
      values: [],
    });
    expect(rows).toEqual([]);
  });

  it("refuses a chunkSize that would push the statement over the cap", async () => {
    await expect(
      queryIn(appEnv, {
        buildSql: (placeholders) =>
          `SELECT id FROM watch_event WHERE watchlist_id = ? AND id IN (${placeholders})`,
        prefix: ["watchlist"],
        values: ["a", "b"],
        chunkSize: D1_MAX_BOUND_PARAMS,
      }),
    ).rejects.toThrow(/exceeds D1_MAX_BOUND_PARAMS/);
  });

  it("does not silently truncate: a plain queryAll of the same set matches", async () => {
    const { watchlistId, runId } = await seedWatchlistWithRun();
    const ids = await seedEvents(watchlistId, runId, 250);

    const chunked = await queryIn<{ id: string }>(appEnv, {
      buildSql: (placeholders) =>
        `SELECT id FROM watch_event WHERE id IN (${placeholders})`,
      values: ids,
    });
    const unchunked = await queryAll<{ id: string }>(
      appEnv,
      "SELECT id FROM watch_event WHERE watchlist_id = ?",
      watchlistId,
    );

    expect(chunked.map((row) => row.id).sort()).toEqual(
      unchunked.map((row) => row.id).sort(),
    );
  });
});
