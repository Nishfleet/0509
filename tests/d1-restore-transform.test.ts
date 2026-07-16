import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_STATEMENT_BYTES, transformD1RestoreSql } from "../scripts/d1-restore-transform.mjs";

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function run(sql: string) {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(sql);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

describe("D1 restore transform", () => {
  it("preserves ordinary SQL and ignores semicolons in strings and comments", () => {
    const source = "-- before;\nCREATE TABLE t (id TEXT PRIMARY KEY, note TEXT);\nINSERT INTO t VALUES ('a; b', 'ok /* ; */');\n";
    const result = transformD1RestoreSql(source);
    expect(result.transformed).toBe(0);
    expect(result.sql).toBe(source);
  });

  it("splits a large NOT NULL raw_json literal into bounded PK-keyed updates", () => {
    const rawJson = JSON.stringify({ text: `line one\n${"😀 quoted 'value' ".repeat(11_000)}` });
    expect(Buffer.byteLength(rawJson)).toBeGreaterThan(100_000);
    const source = `CREATE TABLE ad (id TEXT PRIMARY KEY, raw_json TEXT NOT NULL);\nINSERT INTO ad (id, raw_json) VALUES ('ad-1', ${sqlString(rawJson)});\n`;
    const result = transformD1RestoreSql(source);

    expect(result.transformed).toBe(1);
    expect(Math.max(...result.statementBytes)).toBeLessThanOrEqual(DEFAULT_MAX_STATEMENT_BYTES);
    expect(result.sql).toContain('UPDATE "ad" SET "raw_json" = "raw_json" ||');

    const expected = run(source).prepare("SELECT id, raw_json FROM ad").get() as { id: string; raw_json: string };
    const restored = run(result.sql).prepare("SELECT id, raw_json FROM ad").get() as { id: string; raw_json: string };
    expect(restored).toEqual(expected);
  });

  it("handles a payload with escaped quotes, Unicode, and newlines at a custom bound", () => {
    const payload = `${"अ😀\n'sql'\n".repeat(8_000)}end`;
    expect(Buffer.byteLength(payload)).toBeGreaterThan(100_000);
    const source = `CREATE TABLE discovery_cache_entry (cache_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL); INSERT INTO discovery_cache_entry (cache_key, payload_json) VALUES ('cache-1', ${sqlString(payload)});`;
    const result = transformD1RestoreSql(source, { maxBytes: 12_000 });
    expect(Math.max(...result.statementBytes)).toBeLessThanOrEqual(12_000);
    const expected = run(source).prepare("SELECT cache_key, payload_json FROM discovery_cache_entry").get() as Record<string, string>;
    const restored = run(result.sql).prepare("SELECT cache_key, payload_json FROM discovery_cache_entry").get() as Record<string, string>;
    expect(restored).toEqual(expected);
  });

  it("supports composite primary keys declared at table level", () => {
    const value = "x".repeat(30_000);
    const source = `CREATE TABLE item (workspace_id TEXT, item_id TEXT, payload TEXT, PRIMARY KEY (workspace_id, item_id)); INSERT INTO item (workspace_id, item_id, payload) VALUES ('w', 'i', ${sqlString(value)});`;
    const result = transformD1RestoreSql(source, { maxBytes: 8_000 });
    expect(result.sql).toContain('WHERE "workspace_id" = \'w\' AND "item_id" = \'i\';');
    const restored = run(result.sql).prepare("SELECT payload FROM item").get() as { payload: string };
    expect(restored.payload).toBe(value);
  });

  it.each([
    ["unknown primary key", "CREATE TABLE mystery (id TEXT, payload TEXT); INSERT INTO mystery VALUES ('x', '" + "z".repeat(20_000) + "');"],
    ["computed key expression", "CREATE TABLE thing (id TEXT PRIMARY KEY, payload TEXT); INSERT INTO thing VALUES (lower('X'), '" + "z".repeat(20_000) + "');"],
    ["computed payload expression", "CREATE TABLE thing (id TEXT PRIMARY KEY, payload TEXT); INSERT INTO thing VALUES ('x', printf('%s', '" + "z".repeat(20_000) + "'));"],
  ])("fails closed for %s", (_name, source) => {
    expect(() => transformD1RestoreSql(source, { maxBytes: 8_000 })).toThrow();
  });

  it("fails closed when any unsupported SQL statement exceeds the configured limit", () => {
    expect(() =>
      transformD1RestoreSql(`SELECT '${"z".repeat(20_000)}';`, { maxBytes: 8_000 }),
    ).toThrow("oversized SQL statement");
  });

  it("allows an explicit key map when a data-only export omits schema", () => {
    const value = "v".repeat(20_000);
    const source = `INSERT INTO ad (id, raw_json) VALUES ('ad-1', ${sqlString(value)});`;
    const result = transformD1RestoreSql(source, { maxBytes: 8_000, primaryKeys: { ad: "id" } });
    expect(result.transformed).toBe(1);
    expect(Math.max(...result.statementBytes)).toBeLessThanOrEqual(8_000);
  });
});
