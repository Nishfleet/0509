import { env, type D1Migration } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const TABLE = "rate_limit_events";

function dropMigration(): D1Migration {
  const found = env.TEST_MIGRATIONS.find((migration) => migration.name.endsWith("_drop_rate_limit_events.sql"));
  if (found === undefined) throw new Error("0048_drop_rate_limit_events.sql is missing from TEST_MIGRATIONS");
  return found;
}

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

describe("0048_drop_rate_limit_events.sql", () => {
  it("is the one statement the issue asks for, and creates nothing", () => {
    const statements = statementsOf(dropMigration());
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS rate_limit_events;?$/i);
    expect(statements[0]).not.toMatch(/CREATE/i);
  });

  it("is named by 0001, which creates the table, and by no file but this drop", () => {
    const naming = env.TEST_MIGRATIONS.filter((migration) => statementsOf(migration).some(namesTable)).map(
      (migration) => migration.name,
    );

    expect(naming).toEqual(["0001_rebuild.sql", "0048_drop_rate_limit_events.sql"]);
  });

  it("leaves the table out of the schema the chain builds", async () => {
    const rows = await env.DB.prepare("SELECT type, name FROM sqlite_master WHERE name = ?1")
      .bind(TABLE)
      .all<{ type: string; name: string }>();
    expect(rows.results ?? []).toEqual([]);
  });

  it("closes the read and the write path, not only the table listing", async () => {
    await expect(async () => {
      await env.DB.prepare(`SELECT * FROM ${TABLE}`).all();
    }).rejects.toThrow(/no such table/i);
    await expect(async () => {
      await env.DB.prepare(`INSERT INTO ${TABLE} (id, bucket, subject, occurred_at) VALUES (?1, ?2, ?3, ?4)`)
        .bind("rl-1", "bucket", "subject", "2026-10-06T00:00:00.000Z")
        .run();
    }).rejects.toThrow(/no such table/i);
  });
});
