import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

  it("reorders rows across the full production FK graph, not just one edge", () => {
    // The 2026-08-28 regression test above proves the reorder fixes a single
    // child->parent edge with a synthetic 2-table schema. This test proves it
    // against the REAL 0509 schema: every migration applied, a multi-level FK
    // chain seeded (user -> collection -> collection_item -> ad, and
    // watch_event -> event_candidate -> watchlist_run -> watchlist -> user),
    // and a full dump emitted in child-before-parent order across all tables.
    // node:sqlite autocommits each statement, mirroring D1's per-statement FK
    // enforcement where defer_foreign_keys cannot bridge across statements.
    const migrationsDir = join(__dirname, "..", "migrations");
    const source = new DatabaseSync(":memory:");
    source.exec("PRAGMA foreign_keys = ON;");
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
      source.exec(readFileSync(join(migrationsDir, file), "utf8"));
    }
    const allTables = source
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name as string);
    const colsOf = (table: string) => source.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; notnull: number; dflt_value: string | null; pk: number }[];
    const tableSql = (table: string) =>
      source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string };
    // Seed a minimal valid row, filling NOT NULL non-PK columns and overriding
    // FK columns to point at already-seeded parents (parents seeded first).
    const seed = (table: string, id: string, extra: Record<string, string> = {}) => {
      const cols = colsOf(table);
      const pk = cols.find((c) => c.pk === 1);
      const names: string[] = [];
      const vals: string[] = [];
      if (pk) {
        names.push(`"${pk.name}"`);
        vals.push(`'${id}'`);
      }
      for (const c of cols) {
        if (pk && c.name === pk.name) continue;
        if (extra[c.name] !== undefined) {
          names.push(`"${c.name}"`);
          vals.push(extra[c.name]);
          continue;
        }
        if (c.notnull && c.dflt_value === null && c.pk === 0) {
          names.push(`"${c.name}"`);
          vals.push("'seed'");
        }
      }
      source.exec(`INSERT INTO "${table}" (${names.join(",")}) VALUES (${vals.join(",")})`);
    };
    seed("user", "u1", { name: "'n'", email: "'u1@x.com'", createdAt: "'t'", updatedAt: "'t'" });
    seed("ad", "ad1", {
      advertiser: "'x'", body: "'x'", preview_headline: "'x'", preview_subhead: "'x'",
      hook: "'x'", offer_text: "'x'", cta: "'x'", creative_format: "'x'",
      language_label: "'x'", destination_type: "'x'", countries_json: "'[]'",
      platforms_json: "'[]'", source: "'x'", research_summary: "'x'", raw_json: "'{}'",
      created_at: "'t'", updated_at: "'t'",
    });
    seed("collection", "col1", { user_id: "'u1'", name: "'c1'", created_at: "'t'", updated_at: "'t'" });
    seed("collection_item", "ci1", { collection_id: "'col1'", ad_id: "'ad1'", ad_snapshot_json: "'{}'", created_at: "'t'", updated_at: "'t'" });
    seed("watchlist", "w1", {
      user_id: "'u1'", name: "'wl'", target_type: "'advertiser'", target_id: "'x'",
      target_fingerprint: "'x'", target_label: "'x'", created_at: "'t'", updated_at: "'t'",
    });
    seed("watchlist_run", "r1", {
      watchlist_id: "'w1'", trigger_type: "'manual'", status: "'succeeded'",
      summary_json: "'{}'", started_at: "'t'", created_at: "'t'", updated_at: "'t'",
    });
    seed("event_candidate", "ec1", {
      watchlist_id: "'w1'", run_id: "'r1'", event_type: "'ad_new'", title: "'New ad detected'",
      summary: "'s'", detected_at: "'t'", created_at: "'t'", updated_at: "'t'",
    });
    seed("watch_event", "we1", {
      watchlist_id: "'w1'", run_id: "'r1'", event_type: "'ad_new'", title: "'t'", summary: "'s'",
      metadata_json: "'{}'", created_at: "'t'", candidate_id: "'ec1'",
    });
    // Emit a full dump (every table's CREATE TABLE; rows only for the seeded
    // chain) with the seeded chain in child-before-parent order at the front.
    const seededChildFirst = [
      "collection_item", "watch_event", "event_candidate", "watchlist_run",
      "collection", "watchlist", "ad", "user",
    ];
    const dumpOrder = [...seededChildFirst, ...allTables.filter((t) => !seededChildFirst.includes(t))];
    const dumpTable = (table: string) => {
      const cols = colsOf(table).map((c) => `"${c.name}"`);
      const lines = [`${tableSql(table).sql};`];
      for (const r of source.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]) {
        const vs = colsOf(table).map((c) => {
          const v = r[c.name];
          if (v === null) return "NULL";
          if (typeof v === "number") return String(v);
          return `'${String(v).replaceAll("'", "''")}'`;
        });
        lines.push(`INSERT INTO "${table}" (${cols.join(",")}) VALUES (${vs.join(",")});`);
      }
      return lines.join("\n");
    };
    const dump = ["PRAGMA defer_foreign_keys=TRUE;", ...dumpOrder.map(dumpTable)].join("\n") + "\n";

    // The raw child-first dump must fail to import with FK enforcement —
    // reproduces the production failure class on the real schema.
    const rawImport = () => {
      const db = new DatabaseSync(":memory:");
      try {
        db.exec("PRAGMA foreign_keys = ON;");
        db.exec(dump);
        db.close();
      } catch (error) {
        db.close();
        throw error;
      }
    };
    expect(rawImport).toThrow();

    // The transform reorders parent rows before child rows and imports cleanly.
    const result = transformD1RestoreSql(dump);
    const restored = new DatabaseSync(":memory:");
    restored.exec("PRAGMA foreign_keys = ON;");
    restored.exec(result.sql); // throws on failure

    // Parent INSERTs land before their child INSERTs across both chains.
    const idx = (re: RegExp) => result.statements.findIndex((s) => re.test(s));
    const userI = idx(/^\s*INSERT INTO "user"/);
    const collectionI = idx(/^\s*INSERT INTO "collection"/);
    const collectionItemI = idx(/^\s*INSERT INTO "collection_item"/);
    const eventCandidateI = idx(/^\s*INSERT INTO "event_candidate"/);
    const watchEventI = idx(/^\s*INSERT INTO "watch_event"/);
    expect(userI).toBeGreaterThanOrEqual(0);
    expect(userI).toBeLessThan(collectionI);
    expect(collectionI).toBeLessThan(collectionItemI);
    expect(eventCandidateI).toBeLessThan(watchEventI);

    // Every seeded table's row count matches the source.
    for (const table of seededChildFirst) {
      const a = (source.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
      const b = (restored.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
      expect(b).toBe(a);
    }
    // The child row's FK join resolves to the seeded parent row.
    const joined = restored
      .prepare(
        "SELECT we.id AS we_id, we.candidate_id AS cid, ec.title AS title FROM watch_event we JOIN event_candidate ec ON ec.id = we.candidate_id",
      )
      .get() as { we_id: string; cid: string; title: string };
    expect(joined).toEqual({ we_id: "we1", cid: "ec1", title: "New ad detected" });
    source.close();
    restored.close();
  });
});
