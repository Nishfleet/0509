import { describe, expect, it } from "vitest";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

describe("evidence reservation ownership migration", () => {
  it("adds nullable Workflow ownership without rewriting existing reservations", () => {
    const { sqlite } = createSqliteD1();
    sqlite.exec(`
      CREATE TABLE evidence_usage_reservation (
        id TEXT PRIMARY KEY,
        logical_operation_key TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      INSERT INTO evidence_usage_reservation (
        id, logical_operation_key, status, expires_at
      ) VALUES (
        'reservation-legacy', 'legacy-operation', 'pending', '2026-07-15T00:00:00.000Z'
      );
    `);

    applyMigration(sqlite, "migrations/0068_evidence_reservation_ownership.sql");

    const columns = sqlite
      .prepare("PRAGMA table_info(evidence_usage_reservation)")
      .all() as Array<{ name: string; notnull: number }>;
    expect(
      columns
        .filter((column) => column.name.startsWith("owner_"))
        .map((column) => ({ name: column.name, notnull: column.notnull })),
    ).toEqual([
      { name: "owner_run_id", notnull: 0 },
      { name: "owner_processing_token", notnull: 0 },
      { name: "owner_lease_seen_at", notnull: 0 },
    ]);
    expect(
      sqlite
        .prepare(
          `SELECT owner_run_id, owner_processing_token, owner_lease_seen_at
           FROM evidence_usage_reservation
           WHERE id = 'reservation-legacy'`,
        )
        .get(),
    ).toEqual({
      owner_run_id: null,
      owner_processing_token: null,
      owner_lease_seen_at: null,
    });
    expect(
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
             AND name = 'idx_evidence_usage_reservation_stale_owner'`,
        )
        .get(),
    ).toEqual({ name: "idx_evidence_usage_reservation_stale_owner" });
  });
});
