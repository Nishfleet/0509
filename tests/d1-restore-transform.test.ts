import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_STATEMENT_BYTES, transformD1RestoreSql } from "../scripts/d1-restore-transform.mjs";

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function isPragmaFirst(statements: string[]) {
  return /^\s*PRAGMA\b/iu.test(statements[0] ?? "");
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

  it("restores an export whose child table is created before its parent", () => {
    // Shape of the real 2026-08-25 production export: migration 0077 rebuilt
    // watch_event before it rebuilt event_candidate, so the export emits
    // watch_event and its rows first and event_candidate afterwards. With
    // foreign keys enforced — which is what D1 does on import — the INSERT
    // fails with `no such table: main.event_candidate` and the restore drill,
    // and therefore the deploy gate, goes red.
    const source = [
      "PRAGMA defer_foreign_keys=TRUE;",
      'CREATE TABLE IF NOT EXISTS "watch_event" (',
      "  id TEXT PRIMARY KEY NOT NULL,",
      "  candidate_id TEXT,",
      "  FOREIGN KEY (candidate_id) REFERENCES event_candidate(id) ON DELETE SET NULL",
      ");",
      "INSERT INTO \"watch_event\" (\"id\",\"candidate_id\") VALUES('we-1',NULL);",
      'CREATE TABLE IF NOT EXISTS "event_candidate" (',
      "  id TEXT PRIMARY KEY NOT NULL,",
      "  title TEXT NOT NULL",
      ");",
      "INSERT INTO \"event_candidate\" (\"id\",\"title\") VALUES('ec-1','New ad detected');",
      "CREATE INDEX idx_watch_event_candidate ON watch_event(candidate_id);",
      "",
    ].join("\n");

    const enforced = (sql: string) => {
      const database = new DatabaseSync(":memory:");
      try {
        database.exec("PRAGMA foreign_keys = ON;");
        database.exec(sql);
        return database.prepare("SELECT COUNT(*) AS count FROM watch_event").get() as { count: number };
      } finally {
        database.close();
      }
    };

    expect(() => enforced(source)).toThrow(/no such table: main\.event_candidate/u);

    const result = transformD1RestoreSql(source);
    expect(result.transformed).toBe(0);
    const firstInsert = result.statements.findIndex((statement) => /^\s*INSERT\b/iu.test(statement));
    const lastCreateTable = result.statements.reduce(
      (last, statement, index) => (/^\s*CREATE\s+TABLE\b/iu.test(statement) ? index : last),
      -1,
    );
    expect(lastCreateTable).toBeGreaterThanOrEqual(0);
    expect(lastCreateTable).toBeLessThan(firstInsert);
    expect(isPragmaFirst(result.statements)).toBe(true);
    expect(enforced(result.sql)).toEqual({ count: 1 });
  });

  it("restores an export whose child rows reference parent rows that load later", () => {
    // The 2026-08-28 production failure: the table hoist (commit 1b5095dc)
    // creates every table before any row, so `no such table` is gone, but the
    // rows still land in sqlite_master creation order. When a child table was
    // rebuilt before its parent, the child's rows are emitted first and reference
    // parent rows that have not been inserted yet. D1 enforces foreign keys on
    // import per statement, so the child INSERT fails with
    // `FOREIGN KEY constraint failed` even though the final state is consistent
    // (the parent row exists by commit). `PRAGMA defer_foreign_keys=TRUE` only
    // defers within a transaction, and `wrangler d1 execute --file` does not wrap
    // the file in one, so the deferred pragma cannot help. Ordering the rows so
    // every parent row loads before its child rows removes the dependency on
    // creation order entirely.
    const source = [
      "PRAGMA defer_foreign_keys=TRUE;",
      'CREATE TABLE IF NOT EXISTS "watch_event" (',
      "  id TEXT PRIMARY KEY NOT NULL,",
      "  candidate_id TEXT,",
      "  FOREIGN KEY (candidate_id) REFERENCES event_candidate(id) ON DELETE SET NULL",
      ");",
      "INSERT INTO \"watch_event\" (\"id\",\"candidate_id\") VALUES('we-1','ec-1');",
      'CREATE TABLE IF NOT EXISTS "event_candidate" (',
      "  id TEXT PRIMARY KEY NOT NULL,",
      "  title TEXT NOT NULL",
      ");",
      "INSERT INTO \"event_candidate\" (\"id\",\"title\") VALUES('ec-1','New ad detected');",
      "CREATE INDEX idx_watch_event_candidate ON watch_event(candidate_id);",
      "",
    ].join("\n");

    const enforced = (sql: string) => {
      const database = new DatabaseSync(":memory:");
      try {
        // node:sqlite exec autocommits each statement, mirroring D1's
        // per-statement enforcement where defer_foreign_keys cannot bridge
        // across statements.
        database.exec("PRAGMA foreign_keys = ON;");
        database.exec(sql);
        return database
          .prepare("SELECT we.id AS we_id, we.candidate_id AS cid, ec.title AS title FROM watch_event we JOIN event_candidate ec ON ec.id = we.candidate_id")
          .get() as { we_id: string; cid: string; title: string };
      } finally {
        database.close();
      }
    };

    // The pre-hoist raw export fails because the child table is created before
    // its parent table exists at all (the original 2026-08-25 bug, fixed by
    // the CREATE TABLE hoist in 1b5095dc).
    expect(() => enforced(source)).toThrow(/no such table: main\.event_candidate/u);

    // After the table hoist but WITHOUT row ordering, every table exists so
    // `no such table` is gone, but the child row still loads before the parent
    // row it references. D1 enforces the FK per statement and the restore dies
    // with `FOREIGN KEY constraint failed` — the 2026-08-28 production failure.
    const hoistedButRowUnordered = [
      "PRAGMA defer_foreign_keys=TRUE;",
      'CREATE TABLE IF NOT EXISTS "watch_event" (',
      "  id TEXT PRIMARY KEY NOT NULL,",
      "  candidate_id TEXT,",
      "  FOREIGN KEY (candidate_id) REFERENCES event_candidate(id) ON DELETE SET NULL",
      ");",
      'CREATE TABLE IF NOT EXISTS "event_candidate" (',
      "  id TEXT PRIMARY KEY NOT NULL,",
      "  title TEXT NOT NULL",
      ");",
      "INSERT INTO \"watch_event\" (\"id\",\"candidate_id\") VALUES('we-1','ec-1');",
      "INSERT INTO \"event_candidate\" (\"id\",\"title\") VALUES('ec-1','New ad detected');",
      "CREATE INDEX idx_watch_event_candidate ON watch_event(candidate_id);",
      "",
    ].join("\n");
    expect(() => enforced(hoistedButRowUnordered)).toThrow(/FOREIGN KEY constraint failed/u);

    const result = transformD1RestoreSql(source);
    expect(result.transformed).toBe(0);
    const eventCandidateInsert = result.statements.findIndex((statement) =>
      /^\s*INSERT\s+INTO\s+"event_candidate"/iu.test(statement),
    );
    const watchEventInsert = result.statements.findIndex((statement) =>
      /^\s*INSERT\s+INTO\s+"watch_event"/iu.test(statement),
    );
    expect(eventCandidateInsert).toBeGreaterThanOrEqual(0);
    expect(watchEventInsert).toBeGreaterThanOrEqual(0);
    // Parent rows must load before child rows.
    expect(eventCandidateInsert).toBeLessThan(watchEventInsert);
    expect(isPragmaFirst(result.statements)).toBe(true);
    expect(enforced(result.sql)).toEqual({ we_id: "we-1", cid: "ec-1", title: "New ad detected" });
  });

  it("allows an explicit key map when a data-only export omits schema", () => {
    const value = "v".repeat(20_000);
    const source = `INSERT INTO ad (id, raw_json) VALUES ('ad-1', ${sqlString(value)});`;
    const result = transformD1RestoreSql(source, { maxBytes: 8_000, primaryKeys: { ad: "id" } });
    expect(result.transformed).toBe(1);
    expect(Math.max(...result.statementBytes)).toBeLessThanOrEqual(8_000);
  });
});
