// Per-table row-count invariant for D1 migrations (issue #2779).
//
// Background: on 2026-09-09 migration 0087 rebuilt `user` (DROP TABLE user +
// rename), and 55 `ON DELETE CASCADE` children emptied with it. The only
// guard before the remote apply was "an R2 backup exists"; nothing looked at
// what the migration DID. Rows 0 in user_plan / watchlist / delivery_attempt
// / proof_capture / session were discovered afterwards.
//
// The physical safety net already exists in this repo: the nightly
// restore-evidence drill restores the pre-migration backup into a scratch D1,
// and `collectDatabaseEvidence()` already emits a per-table `rowCounts`
// snapshot. This module is the missing invariant on top of those rails: apply
// the pending migration set to a COPY of the restored database, compare the
// per-table row counts, and refuse any table that shrank unless the migration
// file itself carries an explicit, PR-reviewed annotation:
//
//     -- expects-row-loss: user_plan,watchlist
//
// A migration that genuinely deletes rows must say so in the open, where a
// reviewer sees it in the diff. Silence is the failure this module catches.
//
// Deliberately no new orchestration: one pure parser, one pure comparator,
// and one function that runs migrations against a throwaway sqlite file. The
// callers are the existing restore-evidence script and the existing
// migrations integration-test glob.

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The annotation a migration file uses to declare an intentional row loss.
 * Comma-separated table names on a single line, optionally repeated.
 */
const EXPECTS_ROW_LOSS_PATTERN =
  /^[ \t]*--[ \t]*expects-row-loss:[ \t]*(.+?)[ \t]*$/gimu;

/**
 * Read every `-- expects-row-loss: <table>[,<table>]` annotation from a
 * migration file body. Returns a Set of table names; an empty Set means the
 * migration declares no row loss at all.
 *
 * @param {string} sql
 * @returns {Set<string>}
 */
export function parseExpectsRowLoss(sql) {
  if (typeof sql !== "string") {
    throw new Error("migration_row_invariant_sql_invalid");
  }
  /** @type {Set<string>} */
  const tables = new Set();
  for (const match of sql.matchAll(EXPECTS_ROW_LOSS_PATTERN)) {
    for (const raw of match[1].split(",")) {
      const table = raw.trim();
      if (table.length === 0) {
        throw new Error("migration_row_invariant_annotation_empty_table");
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(table)) {
        throw new Error(
          `migration_row_invariant_annotation_table_invalid:${table}`,
        );
      }
      tables.add(table);
    }
  }
  return tables;
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/**
 * @param {Iterable<{ table: string, count: number }>} rowCounts
 * @returns {Map<string, number>}
 */
function toCountMap(rowCounts) {
  const map = new Map();
  for (const entry of rowCounts) {
    const count = Number(entry?.count);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("migration_row_invariant_count_invalid");
    }
    map.set(String(entry.table), count);
  }
  return map;
}

/**
 * The pure comparison. Every table present before the migration must keep at
 * least as many rows afterwards, unless its name is declared in one of the
 * `expects-row-loss` sets. A table that disappears entirely counts as a loss
 * of all its rows, so `DROP TABLE` of a populated table is caught too.
 *
 * Tables created by the migration are ignored: new tables cannot lose rows
 * that the pre-migration snapshot never had.
 *
 * @param {{
 *   before: Iterable<{ table: string, count: number }>,
 *   after: Iterable<{ table: string, count: number }>,
 *   expectedRowLossByMigration?: Map<string, Set<string>>,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   losses: Array<{
 *     table: string,
 *     before: number,
 *     after: number,
 *     tableRemoved: boolean,
 *   }>,
 *   declared: string[],
 * }}
 */
export function evaluateMigrationRowInvariant({
  before,
  after,
  expectedRowLossByMigration = new Map(),
}) {
  const beforeMap = toCountMap(before);
  const afterMap = toCountMap(after);
  /** @type {Set<string>} */
  const declared = new Set();
  for (const set of expectedRowLossByMigration.values()) {
    for (const table of set) declared.add(table);
  }
  /** @type {Array<{ table: string, before: number, after: number, tableRemoved: boolean }>} */
  const losses = [];
  for (const [table, beforeCount] of [...beforeMap].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (declared.has(table)) continue;
    const tableRemoved = !afterMap.has(table);
    const afterCount = tableRemoved ? 0 : afterMap.get(table) ?? 0;
    if (afterCount < beforeCount) {
      losses.push({ table, before: beforeCount, after: afterCount, tableRemoved });
    }
  }
  return {
    ok: losses.length === 0,
    losses,
    declared: [...declared].sort(),
  };
}

/**
 * Throw when the invariant is violated. Callers that want the structured
 * result use `evaluateMigrationRowInvariant` directly.
 *
 * @param {Parameters<typeof evaluateMigrationRowInvariant>[0]} input
 * @returns {ReturnType<typeof evaluateMigrationRowInvariant>}
 */
export function assertMigrationRowInvariant(input) {
  const verdict = evaluateMigrationRowInvariant(input);
  if (!verdict.ok) {
    const detail = verdict.losses
      .map(
        (loss) =>
          `${loss.table} ${loss.before}->${loss.after}${loss.tableRemoved ? " (table removed)" : ""}`,
      )
      .join(", ");
    throw new Error(`migration_row_loss_unexpected:${detail}`);
  }
  return verdict;
}

/**
 * Human-readable per-table diff for a job summary / PR comment.
 *
 * @param {{
 *   before: Iterable<{ table: string, count: number }>,
 *   after: Iterable<{ table: string, count: number }>,
 * }} input
 * @returns {string}
 */
export function formatRowCountDiff({ before, after }) {
  const beforeMap = toCountMap(before);
  const afterMap = toCountMap(after);
  const tables = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  const lines = ["| table | before | after | delta |", "| --- | --- | --- | --- |"];
  for (const table of tables) {
    const beforeCount = beforeMap.has(table) ? beforeMap.get(table) : null;
    const afterCount = afterMap.has(table) ? afterMap.get(table) : null;
    const delta =
      beforeCount === null || afterCount === null
        ? "n/a"
        : String(afterCount - beforeCount);
    lines.push(
      `| ${table} | ${beforeCount ?? "(absent)"} | ${afterCount ?? "(absent)"} | ${delta} |`,
    );
  }
  return lines.join("\n");
}

/**
 * @param {string} databasePath
 * @returns {Array<{ table: string, count: number }>}
 */
export function readTableRowCounts(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    return tables.map((table) => ({
      table,
      count: Number(
        database
          .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
          .get()?.count ?? 0,
      ),
    }));
  } finally {
    database.close();
  }
}

/**
 * Apply the given migration SQL files to a throwaway copy of `sourcePath` and
 * report the per-table row counts before and after.
 *
 * Mirrors D1's execution shape: foreign key enforcement is ON (D1 rejects
 * `PRAGMA foreign_keys` changes inside its migration transaction, which is
 * exactly why 0087's `PRAGMA foreign_keys = OFF` was a no-op and the cascades
 * fired) and each migration file runs inside one transaction. `sourcePath` is
 * never mutated — the work happens on a copy under the OS temp directory.
 *
 * `applyD1Migrations` is not used here because the workerd test binding is
 * not available outside vitest; this is the same node:sqlite engine the
 * restore-evidence script already uses for `importSqlite` /
 * `collectDatabaseEvidence`.
 *
 * @param {{
 *   sourcePath: string,
 *   migrations: Array<{ name: string, path: string }>,
 *   before?: Array<{ table: string, count: number }>,
 * }} input
 * @returns {{
 *   before: Array<{ table: string, count: number }>,
 *   after: Array<{ table: string, count: number }>,
 *   expectedRowLossByMigration: Map<string, Set<string>>,
 *   applied: string[],
 * }}
 */
export function applyMigrationsToCopy({ sourcePath, migrations, before }) {
  if (!Array.isArray(migrations)) {
    throw new Error("migration_row_invariant_migrations_invalid");
  }
  const root = mkdtempSync(join(tmpdir(), "0509-migration-row-invariant-"));
  const copyPath = join(root, "migration-dry-run.sqlite");
  try {
    copyFileSync(sourcePath, copyPath);
    const database = new DatabaseSync(copyPath, {
      enableForeignKeyConstraints: true,
    });
    /** @type {Map<string, Set<string>>} */
    const expectedRowLossByMigration = new Map();
    /** @type {string[]} */
    const applied = [];
    try {
      const beforeCounts = before ?? readTableRowCounts(copyPath);
      for (const migration of migrations) {
        const sql = readFileSync(migration.path, "utf8");
        expectedRowLossByMigration.set(
          migration.name,
          parseExpectsRowLoss(sql),
        );
        database.exec("BEGIN");
        try {
          database.exec(sql);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        applied.push(migration.name);
      }
      return {
        before: beforeCounts,
        after: readTableRowCounts(copyPath),
        expectedRowLossByMigration,
        applied,
      };
    } finally {
      database.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
