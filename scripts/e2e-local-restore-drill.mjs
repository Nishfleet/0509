// @ts-nocheck Local release restore proof is validated through aggregate-only evidence.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_MAX_STATEMENT_BYTES,
  transformD1RestoreSql,
} from "./d1-restore-transform.mjs";
import { resolveLocalD1DatabasePath } from "./e2e-local-state-query.mjs";

const SQLITE_PATH = "/usr/bin/sqlite3";
const PYTHON_PATH = "/usr/bin/python3";
const RESTORE_TIMEOUT_MS = 30_000;
const MAX_DUMP_BYTES = 64 * 1024 * 1024;
const PYTHON_ITERDUMP_SCRIPT = [
  "import sqlite3",
  "import sys",
  "from pathlib import Path",
  "database_uri = Path(sys.argv[1]).resolve().as_uri() + '?mode=ro'",
  "database = sqlite3.connect(database_uri, uri=True)",
  "try:",
  "    for statement in database.iterdump():",
  "        print(statement)",
  "finally:",
  "    database.close()",
].join("\n");

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sqliteCliDump(databasePath) {
  const result = spawnSync(SQLITE_PATH, [databasePath, ".dump"], {
    encoding: "utf8",
    maxBuffer: MAX_DUMP_BYTES,
    timeout: RESTORE_TIMEOUT_MS,
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("scratch_restore_export_timeout");
  if (result.error || result.status !== 0 || !result.stdout?.trim()) {
    throw new Error("scratch_restore_export_failed");
  }
  return result.stdout;
}

function sqliteCliImport(databasePath, sql) {
  const result = spawnSync(SQLITE_PATH, [databasePath], {
    encoding: "utf8",
    input: sql,
    maxBuffer: MAX_DUMP_BYTES,
    timeout: RESTORE_TIMEOUT_MS,
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("scratch_restore_import_timeout");
  if (result.error || result.status !== 0) throw new Error("scratch_restore_import_failed");
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function pythonSqliteDump(databasePath) {
  const result = spawnSync(PYTHON_PATH, ["-c", PYTHON_ITERDUMP_SCRIPT, databasePath], {
    encoding: "utf8",
    maxBuffer: MAX_DUMP_BYTES,
    timeout: RESTORE_TIMEOUT_MS,
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("scratch_restore_export_timeout");
  if (result.error || result.status !== 0 || !result.stdout?.trim()) {
    throw new Error("scratch_restore_export_failed");
  }
  return result.stdout;
}

function nodeSqliteImport(databasePath, sql) {
  if (Buffer.byteLength(sql) > MAX_DUMP_BYTES) {
    throw new Error("scratch_restore_import_failed");
  }
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: false,
    timeout: RESTORE_TIMEOUT_MS,
  });
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}

function sqliteDump(databasePath) {
  if (existsSync(SQLITE_PATH)) return sqliteCliDump(databasePath);
  if (existsSync(PYTHON_PATH)) return pythonSqliteDump(databasePath);
  throw new Error("scratch_restore_export_failed");
}

function sqliteImport(databasePath, sql) {
  if (existsSync(SQLITE_PATH)) {
    sqliteCliImport(databasePath, sql);
    return;
  }
  try {
    nodeSqliteImport(databasePath, sql);
  } catch {
    throw new Error("scratch_restore_import_failed");
  }
}

function databaseEvidence(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get();
    const integrityValue = String(Object.values(integrity ?? {})[0] ?? "");
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all().length;
    const tables = database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => String(row.name));
    const tableRows = Object.fromEntries(tables.map((table) => {
      const row = database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get();
      return [table, Number(row?.count ?? 0)];
    }));
    const migration = database.prepare(`
      SELECT COUNT(*) AS count, COALESCE(MAX(id), 0) AS latest_id
      FROM d1_migrations
    `).get();
    const billing = database.prepare(`
      SELECT COUNT(*) AS plans,
             SUM(CASE WHEN dodo_payment_id IS NOT NULL
                        OR dodo_subscription_id IS NOT NULL
                        OR dodo_customer_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
      FROM user_plan
    `).get();
    return {
      integrity: integrityValue,
      foreignKeyViolations,
      tableRows,
      migrations: Number(migration?.count ?? 0),
      latestMigrationId: Number(migration?.latest_id ?? 0),
      planRows: Number(billing?.plans ?? 0),
      linkedPlanRows: Number(billing?.linked ?? 0),
    };
  } finally {
    database.close();
  }
}

export function runLocalD1ScratchRestore({ persistPath, outputRoot }) {
  const sourcePath = resolveLocalD1DatabasePath(persistPath);
  const directory = mkdtempSync(resolve(outputRoot, "e2e-restore-"));
  const restoredPath = resolve(directory, "scratch.sqlite");
  try {
    const sourceSql = sqliteDump(sourcePath);
    const transformed = transformD1RestoreSql(sourceSql, {
      maxBytes: DEFAULT_MAX_STATEMENT_BYTES,
    });
    sqliteImport(restoredPath, transformed.sql);
    const source = databaseEvidence(sourcePath);
    const restored = databaseEvidence(restoredPath);
    if (source.integrity !== "ok" || restored.integrity !== "ok") {
      throw new Error("scratch_restore_integrity_failed");
    }
    if (source.foreignKeyViolations !== 0 || restored.foreignKeyViolations !== 0) {
      throw new Error("scratch_restore_foreign_keys_failed");
    }
    if (JSON.stringify(source.tableRows) !== JSON.stringify(restored.tableRows)) {
      throw new Error("scratch_restore_row_counts_mismatch");
    }
    if (
      source.migrations !== restored.migrations ||
      source.latestMigrationId !== restored.latestMigrationId ||
      source.planRows !== restored.planRows ||
      source.linkedPlanRows !== restored.linkedPlanRows
    ) {
      throw new Error("scratch_restore_release_linkage_mismatch");
    }
    const maximumStatementBytes = Math.max(0, ...transformed.statementBytes);
    if (maximumStatementBytes > DEFAULT_MAX_STATEMENT_BYTES) {
      throw new Error("scratch_restore_statement_limit_failed");
    }
    return {
      sourceDumpSha256: hash(sourceSql),
      transformedSqlSha256: hash(transformed.sql),
      sourceBytes: Buffer.byteLength(sourceSql),
      transformedBytes: Buffer.byteLength(transformed.sql),
      transformedStatements: transformed.transformed,
      maximumStatementBytes,
      tableCount: Object.keys(source.tableRows).length,
      totalRows: Object.values(source.tableRows).reduce((sum, value) => sum + value, 0),
      migrations: source.migrations,
      latestMigrationId: source.latestMigrationId,
      planRows: source.planRows,
      linkedPlanRows: source.linkedPlanRows,
      integrity: "ok",
      foreignKeyViolations: 0,
      exactRowCounts: true,
      dodoLinkagePreserved: true,
      scratchDatabaseRemoved: true,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
    if (existsSync(directory)) throw new Error("scratch_restore_cleanup_failed");
  }
}
