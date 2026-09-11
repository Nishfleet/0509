import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

/**
 * Regression gate for issue #2774 / fleet-ops#4999.
 *
 * On 2026-09-09 migration 0087 ran against production D1 and emptied every
 * `REFERENCES user(id) ON DELETE CASCADE` descendant (user_plan, watchlist,
 * delivery_attempt, proof_capture, session, ...). Cause: the file opened with
 * `PRAGMA foreign_keys = OFF`, which is a no-op inside the transaction D1
 * wraps each migration in, so `DROP TABLE user` ran its implicit
 * `DELETE FROM user` with enforcement ON and the delete cascaded.
 *
 * This test rebuilds the incident on a scratch SQLite database:
 *   1. apply the repo's real migrations that precede 0087 (in D1 filename
 *      order) with `PRAGMA foreign_keys = ON`,
 *   2. seed account-scoped rows — the five tables named in the incident
 *      census plus the proof_target/proof_capture grandchild chain that
 *      proves transitive cascades are covered,
 *   3. apply 0087 inside `BEGIN ... COMMIT`, exactly as D1 does,
 *   4. assert every seeded row survives, foreign_key_check is clean, the
 *      staging tables are gone, and the rewritten CHECK still accepts the
 *      open-allowlist shape.
 *
 * The node:sqlite engine is the same SQLite the repo already harnesses in
 * tests/helpers/sqlite-d1.ts; the explicit transaction wrap reproduces the
 * production apply semantics that made the pragma a no-op. This test fails
 * against the pre-rewrite file (children empty) and passes on the rewrite.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");
const TARGET = "0087_signup_source_open_allowlist.sql";

const WATCHED_TABLES = [
  "user",
  "user_plan",
  "watchlist",
  "proof_target",
  "proof_capture",
  "session",
  "delivery_target",
  "delivery_attempt",
  "signup_source_pending",
] as const;

function buildPreTargetDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    if (name >= TARGET) break;
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
  }
  return sqlite;
}

function seedAccountScopedRows(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO user (id, name, email, createdAt, updatedAt)
      VALUES ('u1', 'Cascade Guard', 'u1@example.test', '2026-01-01', '2026-01-01');
    INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
      VALUES ('s1', '2030-01-01', 'token-s1', '2026-01-01', '2026-01-01', 'u1');
    INSERT INTO user_plan (user_id) VALUES ('u1');
    INSERT INTO watchlist (
      id, user_id, name, target_type, target_id, target_fingerprint,
      target_label, created_at, updated_at
    ) VALUES ('w1', 'u1', 'Guard watchlist', 'advertiser', 'target-w1', 'fp-w1',
              'guard.example', '2026-01-01', '2026-01-01');
    INSERT INTO delivery_target (
      id, user_id, watchlist_id, channel, target_value, created_at, updated_at
    ) VALUES ('dt1', 'u1', 'w1', 'email', 'u1@example.test',
              '2026-01-01', '2026-01-01');
    INSERT INTO delivery_attempt (
      id, user_id, watchlist_id, delivery_target_id, lane, channel, provider,
      status, target_value, created_at, updated_at
    ) VALUES ('da1', 'u1', 'w1', 'dt1', 'customer', 'email', 'cf-email',
              'sent', 'u1@example.test', '2026-01-01', '2026-01-01');
    INSERT INTO proof_target (
      id, watchlist_id, canonical_page_identity, proof_target_identity,
      created_at, updated_at
    ) VALUES ('pt1', 'w1', 'guard.example/page', 'guard.example/page#ad1',
              '2026-01-01', '2026-01-01');
    INSERT INTO proof_capture (
      id, proof_target_id, status, extractor_version, attempted_at,
      created_at, updated_at
    ) VALUES ('pc1', 'pt1', 'succeeded', 'v1', '2026-01-01',
              '2026-01-01', '2026-01-01');
    INSERT INTO signup_source_pending (email, signup_source, created_at, expires_at)
      VALUES ('pending@example.test', 'magicbrief-migration', '2026-01-01', '2030-01-01');
  `);
}

function rowCounts(sqlite: DatabaseSync) {
  const counts: Record<string, number> = {};
  for (const table of WATCHED_TABLES) {
    counts[table] = Number(
      (sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c,
    );
  }
  return counts;
}

describe("migration 0087 — user rebuild cannot cascade (issue #2774)", () => {
  it("preserves every account-scoped row when applied inside a transaction", () => {
    const sqlite = buildPreTargetDb();
    seedAccountScopedRows(sqlite);
    const before = rowCounts(sqlite);
    for (const table of WATCHED_TABLES) {
      expect(before[table], `seed failed for ${table}`).toBe(1);
    }

    sqlite.exec("BEGIN");
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, TARGET), "utf8"));
    sqlite.exec("COMMIT");

    expect(rowCounts(sqlite)).toEqual(before);

    const violations = sqlite.prepare("PRAGMA foreign_key_check").all();
    expect(violations).toEqual([]);

    const leftovers = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'mig0087_%'")
      .all();
    expect(leftovers).toEqual([]);
  });

  it("keeps child references bound to the rebuilt user table", () => {
    const sqlite = buildPreTargetDb();
    seedAccountScopedRows(sqlite);
    sqlite.exec("BEGIN");
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, TARGET), "utf8"));
    sqlite.exec("COMMIT");

    // The rebuilt `user` is the object children resolve to: deleting it must
    // still cascade, which proves REFERENCES point at the new table.
    sqlite.exec("DELETE FROM user WHERE id = 'u1'");
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS c FROM session").get() as { c: number }).c,
    ).toBe(0);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS c FROM watchlist").get() as { c: number }).c,
    ).toBe(0);
  });

  it("produces the open-allowlist CHECK (write accepts a slug, rejects junk)", () => {
    const sqlite = buildPreTargetDb();
    sqlite.exec("BEGIN");
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, TARGET), "utf8"));
    sqlite.exec("COMMIT");

    sqlite.exec(
      `INSERT INTO user (id, name, email, createdAt, updatedAt, signup_source)
       VALUES ('u2', 'T', 'u2@example.test', '2026-01-01', '2026-01-01', 'summer-2026-launch')`,
    );
    expect(
      sqlite
        .prepare("SELECT signup_source FROM user WHERE id = 'u2'")
        .get() as { signup_source: string },
    ).toEqual({ signup_source: "summer-2026-launch" });

    expect(() =>
      sqlite.exec(
        `INSERT INTO user (id, name, email, createdAt, updatedAt, signup_source)
         VALUES ('u3', 'T', 'u3@example.test', '2026-01-01', '2026-01-01', 'Bad Source!')`,
      ),
    ).toThrow();
  });
});
