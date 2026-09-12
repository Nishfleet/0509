// Cascade coverage test (issue #3168). Enumerates every CREATE TABLE in
// migrations/*.sql and asserts that every table whose row references a user
// (user_id, userId, workspace_user_id, workspace_id, owner_user_id) is in
// the ACCOUNT_DELETION_CASCADE_TABLES list. This is the test the spec
// requires: a missing entry means a hard-deleted user leaves orphaned rows
// behind, which is a privacy bug.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ACCOUNT_DELETION_CASCADE_TABLES } from "~/lib/account-self-serve.server";

const USER_REFERENCE_COLUMNS = new Set([
  "user_id",
  "userId",
  "workspace_user_id",
  "workspace_id",
  "owner_user_id",
]);

const SKIP_TABLES = new Set([
  // Migration shadow tables that get renamed away; not live in the DB.
  "mig0087_*",
  "pc_bk_0093",
  "pi_bk_0093",
  "pir_bk_0093",
  "delivery_target_next",
  "delivery_attempt_next",
  "user_plan_next",
  "source_target_rss_widen_new",
  // The spec keeps audit rows that outlive the user (issue #3168):
  // "keep only the suppression-list entry and an anonymised deletion audit
  // row". The email-suppression ledger stays; the deletion/email-change
  // audit rows also stay so support/ops can answer "was this row ever
  // deleted?" later. These tables intentionally do NOT FK-cascade to user.
  "email_suppression",
  "account_deletion_request",
  "account_email_change_request",
]);

function readMigrationsDir(): string[] {
  // vitest runs with cwd = the repo root by convention.
  const dir = join(process.cwd(), "migrations");
  return readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
}

function parseCreateTables(sql: string): { table: string; columns: string[] }[] {
  const tables: { table: string; columns: string[] }[] = [];
  const createRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\)\s*;/g;
  for (const match of sql.matchAll(createRe)) {
    const table = match[1]!;
    const body = match[2]!;
    const columns: string[] = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line || line.startsWith("--")) continue;
      const columnMatch = /^\s*(\w+)\s+(?:INTEGER|TEXT|REAL|BLOB)/.exec(line);
      if (columnMatch) {
        columns.push(columnMatch[1]!);
      }
    }
    tables.push({ table, columns });
  }
  return tables;
}

function collectUserKeyedTables(): { table: string; columns: string[] }[] {
  const matches: { table: string; columns: string[] }[] = [];
  for (const file of readMigrationsDir()) {
    const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
    for (const table of parseCreateTables(sql)) {
      const userCols = table.columns.filter((c) => USER_REFERENCE_COLUMNS.has(c));
      if (userCols.length === 0) continue;
      // Skip the user table itself (it has `id`, not a user-ref).
      if (table.table === "user") continue;
      matches.push({ table: table.table, columns: userCols });
    }
  }
  // Deduplicate by table name (some migrations reference the same table in
  // CREATE TABLE AS SELECT ... — the column list is the schema after the
  // migration, so we only need one entry per table).
  const byName = new Map<string, { table: string; columns: string[] }>();
  for (const m of matches) {
    const prev = byName.get(m.table);
    if (!prev || m.columns.length > prev.columns.length) {
      byName.set(m.table, m);
    }
  }
  // Drop tables that are eventually DROP TABLEd in a later migration AND
  // do not get renamed back — e.g. pricing_region_preference was created
  // in 0001 and dropped in 0016 with no RENAME, so it never existed in
  // the live schema. delivery_attempt was also dropped and recreated, but
  // ALTER TABLE ... RENAME TO delivery_attempt puts it back live.
  const droppedNoRename = new Set<string>();
  for (const file of readMigrationsDir()) {
    const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
    for (const drop of sql.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+(\w+)\s*;/g)) {
      const table = drop[1]!;
      const renamedBack = new RegExp(`RENAME TO ${table}\\b`).test(sql);
      if (!renamedBack) {
        droppedNoRename.add(table);
      }
    }
  }
  return [...byName.values()].filter((m) => !droppedNoRename.has(m.table));
}

describe("ACCOUNT_DELETION_CASCADE_TABLES coverage", () => {
  it("covers every table that holds a user foreign key", () => {
    const live = collectUserKeyedTables().filter(
      ({ table }) => !table.startsWith("mig0087_") && !SKIP_TABLES.has(table),
    );
    const covered = new Set<string>(ACCOUNT_DELETION_CASCADE_TABLES);
    const missing = live.filter(({ table }) => !covered.has(table));

    expect(missing, `Tables with user FKs not in cascade list: ${JSON.stringify(missing.map((m) => m.table))}`)
      .toEqual([]);
  });

  it("does not list tables that do not exist in migrations", () => {
    const live = new Set(collectUserKeyedTables().map(({ table }) => table));
    const phantom: string[] = ACCOUNT_DELETION_CASCADE_TABLES.filter((table) => !live.has(table));
    expect(
      phantom,
      `Cascade tables without a corresponding migration: ${JSON.stringify(phantom)}`,
    ).toEqual([]);
  });

  it("does not list the user table itself (FK target, not subject)", () => {
    expect(ACCOUNT_DELETION_CASCADE_TABLES).not.toContain("user");
  });
});