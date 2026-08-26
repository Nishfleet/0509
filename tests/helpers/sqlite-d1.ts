import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type SqliteBindings = Parameters<ReturnType<DatabaseSync["prepare"]>["run"]>;

function numberedPlaceholderIndexes(sql: string): number[] {
  const found = new Set<number>();
  for (const match of sql.matchAll(/\?(\d+)/g)) {
    found.add(Number(match[1]));
  }
  return [...found];
}

function hasAnonymousPlaceholders(sql: string): boolean {
  return sql.replace(/\?\d+/g, "").includes("?");
}

/**
 * D1 `.bind(a, b, c)` maps onto `?1`, `?2`, `?3`, and a reused `?5` still
 * takes one value. node:sqlite treats `?NNN` as named parameters, so spreading
 * those same values as anonymous rest args throws SQLITE_RANGE
 * ("column index out of range").
 */
function toSqliteBindings(sql: string, bindings: unknown[]): SqliteBindings {
  const indexes = numberedPlaceholderIndexes(sql);
  if (indexes.length === 0) {
    return bindings as SqliteBindings;
  }
  if (hasAnonymousPlaceholders(sql)) {
    throw new Error(
      "sqlite-d1 helper cannot mix numbered (?1) and anonymous (?) placeholders in one statement",
    );
  }

  const named: Record<string, unknown> = {};
  for (const index of indexes) {
    named[`?${index}`] = bindings[index - 1];
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
