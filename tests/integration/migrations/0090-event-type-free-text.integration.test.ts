import { describe, expect, it } from "vitest";

import { db, ISO_T0, seedWatchlistWithRun, uid } from "../fixtures";

/**
 * Migration-test gate for issue #2334 — proves migration 0090 rebuilt
 * `event_candidate` and `watch_event` so `event_type` is unconstrained free
 * text (validated in code via the source adapter registry, #2333), keeps every
 * legacy row/value, and gains a nullable `source_kind` column.
 *
 * It runs against the `workers` vitest project, which applies the repo's real
 * `migrations/*.sql` via `tests/integration/apply-migrations.ts` before any
 * test runs — so a schema here is the real post-0090 schema.
 *
 * Acceptance asserts both the new READ (schema exposes `source_kind`; legacy
 * event types round-trip unchanged) and the new WRITE (a brand-new event type
 * that no CHECK ever allowed is accepted and reads back; `source_kind` is
 * writable).
 */

async function columnsFor(table: string): Promise<Set<string>> {
  const rows = await db()
    .prepare(`PRAGMA table_info(${table})`)
    .all<{ name: string }>();
  return new Set((rows.results ?? []).map((r) => r.name));
}

/**
 * Assert the LIVE table definition no longer CHECK-constrains event_type. A
 * negative lookahead keeps this honest: `event_type TEXT NOT NULL` must be
 * immediately followed by something other than a CHECK block.
 */
async function eventTypeIsFreeText(table: string): Promise<boolean> {
  const row = await db()
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(table)
    .first<{ sql: string }>();
  const sql = row?.sql ?? "";
  // Free text = the event_type column declaration has no inline CHECK.
  return /event_type\s+TEXT\s+NOT NULL\s*(?!CHECK\b)/.test(sql);
}

describe("migration 0090 — event_type free text + source_kind (issue #2334)", () => {
  it("exposes a source_kind column and drops the event_type CHECK on event_candidate", async () => {
    const cols = await columnsFor("event_candidate");
    expect(cols.has("source_kind")).toBe(true);
    expect(await eventTypeIsFreeText("event_candidate")).toBe(true);
  });

  it("exposes a source_kind column and drops the event_type CHECK on watch_event", async () => {
    const cols = await columnsFor("watch_event");
    expect(cols.has("source_kind")).toBe(true);
    expect(await eventTypeIsFreeText("watch_event")).toBe(true);
  });

  it("accepts a legacy event_type and reads it back unchanged (read path)", async () => {
    const { watchlistId, runId } = await seedWatchlistWithRun();
    const id = uid("evt_legacy");
    await db()
      .prepare(
        `INSERT INTO watch_event (
           id, watchlist_id, run_id, event_type, title, summary,
           metadata_json, created_at
         ) VALUES (?, ?, ?, 'ad_new', 'Legacy', 'Legacy summary', '{}', ?)`,
      )
      .bind(id, watchlistId, runId, ISO_T0)
      .run();

    const row = await db()
      .prepare(
        `SELECT event_type, source_kind, title FROM watch_event WHERE id = ?`,
      )
      .bind(id)
      .first<{ event_type: string; source_kind: string | null; title: string }>();
    expect(row).not.toBeNull();
    expect(row?.event_type).toBe("ad_new");
    expect(row?.source_kind).toBeNull(); // legacy rows have no source kind yet
    expect(row?.title).toBe("Legacy");
  });

  it("writes a brand-new event_type and source_kind, then reads them back (write path)", async () => {
    const { watchlistId, runId } = await seedWatchlistWithRun();

    const candidateId = uid("cand_new");
    await db()
      .prepare(
        `INSERT INTO event_candidate (
           id, watchlist_id, run_id, source_kind, event_type, status,
           title, summary, detected_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'government_source', 'transparency_daily_filing',
           'confirmed', 'New source', 'New summary', ?, ?, ?)`,
      )
      .bind(candidateId, watchlistId, runId, ISO_T0, ISO_T0, ISO_T0)
      .run();

    const candRow = await db()
      .prepare(
        `SELECT source_kind, event_type, status FROM event_candidate WHERE id = ?`,
      )
      .bind(candidateId)
      .first<{ source_kind: string; event_type: string; status: string }>();
    expect(candRow).not.toBeNull();
    expect(candRow?.source_kind).toBe("government_source");
    // No CHECK ever listed this value — free-text event_type accepted it.
    expect(candRow?.event_type).toBe("transparency_daily_filing");
    expect(candRow?.status).toBe("confirmed");

    const watchId = uid("evt_new");
    await db()
      .prepare(
        `INSERT INTO watch_event (
           id, watchlist_id, run_id, source_kind, event_type, status,
           title, summary, metadata_json, created_at
         ) VALUES (?, ?, ?, 'government_source', 'transparency_daily_filing',
           'confirmed', 'New event', 'New summary', '{}', ?)`,
      )
      .bind(watchId, watchlistId, runId, ISO_T0)
      .run();

    const watchRow = await db()
      .prepare(
        `SELECT source_kind, event_type FROM watch_event WHERE id = ?`,
      )
      .bind(watchId)
      .first<{ source_kind: string; event_type: string }>();
    expect(watchRow).not.toBeNull();
    expect(watchRow?.source_kind).toBe("government_source");
    expect(watchRow?.event_type).toBe("transparency_daily_filing");
  });
});