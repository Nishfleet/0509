import { env, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * 0051_drop_rate_limit_events.sql (#7194, parent audit #7080), proven in real
 * workerd against real D1 once the whole chain has applied.
 *
 * The issue asks for one thing: the table is gone after the chain applies. The
 * setup file applies every file in migrations/ before this suite, so the
 * assertions below are about the schema the deploy ships, and the migration is
 * read out of TEST_MIGRATIONS rather than restated here, so the test cannot
 * pass against a copy that has drifted from the file that ships
 * (migration-0040.integration.test.ts).
 *
 * A statement that fails is the stronger claim: a table the app still reaches
 * would resolve even with an empty row list, so an absent sqlite_master row
 * alone cannot tell "dropped" from "empty".
 *
 * The resurrection vector is the migration chain, not the app source: nothing
 * in app/, workers/ or e2e/ can bring the table back, because a table exists
 * only once a file in migrations/ creates it, and the assertion below scans
 * every one of those files. A future writer that reaches for the table anyway
 * fails at prepare time, which is exactly what the read and write assertions
 * pin.
 */

const TABLE = "rate_limit_events";

function dropMigration(): D1Migration {
  const found = env.TEST_MIGRATIONS.find((migration) => migration.name.endsWith("_drop_rate_limit_events.sql"));
  if (found === undefined) throw new Error("0051_drop_rate_limit_events.sql is missing from TEST_MIGRATIONS");
  return found;
}

/** query text with the leading comment lines dropped, so statements can be counted. */
function statementsOf(migration: D1Migration): string[] {
  return migration.queries
    .map((query) =>
      query
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((query) => query.length > 0);
}

function namesTable(text: string): boolean {
  return new RegExp(`\\b${TABLE}\\b`, "i").test(text);
}

describe("0051_drop_rate_limit_events.sql", () => {
  it("is the one statement the issue asks for, and creates nothing", () => {
    const statements = statementsOf(dropMigration());
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS rate_limit_events;?$/i);
    expect(statements[0]).not.toMatch(/CREATE/i);
  });

  it("is the only file after 0001 that names the table", () => {
    const naming = env.TEST_MIGRATIONS.filter((migration) => statementsOf(migration).some(namesTable)).map(
      (migration) => migration.name,
    );
    // 0001 creates the table; this file drops it. A third name means a
    // resurrection, or a second drop folded into an in-flight packet.
    expect(naming).toEqual(["0001_rebuild.sql", "0051_drop_rate_limit_events.sql"]);
  });

  it("leaves the table out of the schema the chain builds", async () => {
    const rows = await env.DB.prepare("SELECT type, name FROM sqlite_master WHERE name = ?1")
      .bind(TABLE)
      .all<{ type: string; name: string }>();
    expect(rows.results ?? []).toEqual([]);
  });

  it("closes the read and the write path, not only the table listing", async () => {
    await expect(env.DB.prepare(`SELECT * FROM ${TABLE}`).all()).rejects.toThrow(/no such table/i);
    await expect(
      env.DB.prepare(`INSERT INTO ${TABLE} (id, bucket, subject, occurred_at) VALUES (?1, ?2, ?3, ?4)`)
        .bind("rl-1", "bucket", "subject", "2026-10-06T00:00:00.000Z")
        .run(),
    ).rejects.toThrow(/no such table/i);
  });
});
