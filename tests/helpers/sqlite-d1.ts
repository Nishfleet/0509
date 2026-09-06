import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type SqliteBindings = Parameters<ReturnType<DatabaseSync["prepare"]>["run"]>;

const NUMBERED_PLACEHOLDER = /\?([1-9]\d*)/g;

function numberedPlaceholderIndexes(sql: string): Set<number> {
  const indexes = new Set<number>();
  for (const match of sql.matchAll(NUMBERED_PLACEHOLDER)) {
    indexes.add(Number(match[1]));
  }
  return indexes;
}

function toSqliteValue(value: unknown) {
  return value === undefined ? null : value;
}

function toSqliteBindings(sql: string, bindings: unknown[]): SqliteBindings {
  const indexes = numberedPlaceholderIndexes(sql);
  if (indexes.size === 0) {
    return bindings as SqliteBindings;
  }

  // node:sqlite (Node 24) treats ?1 as a named parameter. Spreading the D1
  // bind list as anonymous values throws SQLITE_RANGE ("column index out of range").
  // Only names that appear in the SQL are accepted; skipped numbers (?4 when
  // the query uses ?1 and ?6) are unknown named parameters, not unused slots.
  const named: Record<string, ReturnType<typeof toSqliteValue>> = {};
  for (const index of indexes) {
    named[String(index)] = toSqliteValue(bindings[index - 1]);
  }
  return [named] as SqliteBindings;
}

export function applyMigration(sqlite: DatabaseSync, path: string) {
  sqlite.exec(readFileSync(path, "utf8"));
}

export function createSqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  return {
    close: () => sqlite.close(),
    sqlite,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            const bound = toSqliteBindings(sql, bindings);
            return {
              async run() {
                const result = sqlite.prepare(sql).run(...bound);
                return {
                  success: true,
                  meta: {
                    changes: Number(result.changes ?? 0),
                    last_row_id: Number(result.lastInsertRowid ?? 0),
                  },
                };
              },
              async all<T>() {
                return {
                  results: sqlite.prepare(sql).all(...bound) as T[],
                };
              },
              async first<T>() {
                return (sqlite.prepare(sql).get(...bound) as T | undefined) ?? null;
              },
            };
          },
        };
      },
      async batch<T extends { run(): Promise<{ meta?: { changes?: number } }> }>(statements: T[]) {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const results = [];
          for (const statement of statements) {
            results.push(await statement.run());
          }
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}
