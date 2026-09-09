#!/usr/bin/env node

// Purge `user_plan` rows that belong to `@example.com` test users (issue #2118).
//
// Modes (dry-run is the default; exactly one may be given):
//   --dry-run  list the matching rows and exit 0 without touching anything
//   --apply    delete exactly the listed rows, then prove none remain
//   --check    exit 1 if any `@example.com` plan rows remain (check:d1:no-test-plans)
//
// Target defaults to production D1 (`--remote`); pass `--local` for the local D1.
// Only the `user_plan` table is ever written; `user` is read for the email join.

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DATABASE_NAME = "0509";
export const TEST_EMAIL_DOMAIN = "@example.com";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MODE_FLAGS = /** @type {const} */ ({
  "--dry-run": "dry-run",
  "--apply": "apply",
  "--check": "check",
});

/**
 * @typedef {"dry-run" | "apply" | "check"} Mode
 * @typedef {{ databaseName: string, mode: Mode, remote: boolean }} Input
 * @typedef {Record<string, unknown>} D1Row
 * @typedef {{ changes: number | null, rows: D1Row[] }} D1Result
 * @typedef {{ email: string, plan: string, plan_updated_at: string, user_id: string }} TestPlanRow
 */

/**
 * @param {string[]} argv
 * @returns {Input}
 */
export function parseArgs(argv) {
  /** @type {Mode[]} */
  const modes = [];
  let remote = true;
  let databaseName = DATABASE_NAME;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg in MODE_FLAGS) {
      modes.push(MODE_FLAGS[/** @type {keyof typeof MODE_FLAGS} */ (arg)]);
    } else if (arg === "--remote") {
      remote = true;
    } else if (arg === "--local") {
      remote = false;
    } else if (arg === "--database") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--database needs a value.");
      databaseName = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (modes.length > 1) {
    throw new Error("Pass at most one of --dry-run, --apply, --check.");
  }

  return { databaseName, mode: modes[0] ?? "dry-run", remote };
}

/**
 * @param {string} value
 */
function quoteString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/** SQL predicate that selects `user` rows whose email ends with the test domain (case-insensitive). */
export function testUserPredicate() {
  return `lower("user"."email") LIKE ${quoteString(`%${TEST_EMAIL_DOMAIN}`)}`;
}

/** Lists every `user_plan` row joined to an `@example.com` user. */
export function buildListSql() {
  return [
    "SELECT user_plan.user_id AS user_id, \"user\".email AS email, user_plan.plan AS plan, user_plan.plan_updated_at AS plan_updated_at",
    "FROM user_plan",
    'JOIN "user" ON "user".id = user_plan.user_id',
    `WHERE ${testUserPredicate()}`,
    'ORDER BY "user".email;',
  ].join(" ");
}

/** Counts the rows `buildListSql()` would return. */
export function buildCountSql() {
  return [
    "SELECT COUNT(*) AS count",
    "FROM user_plan",
    'JOIN "user" ON "user".id = user_plan.user_id',
    `WHERE ${testUserPredicate()};`,
  ].join(" ");
}

/**
 * Deletes only the explicitly listed user ids, and only while they still belong to an
 * `@example.com` user, so nothing outside the dry-run listing can ever be removed.
 * @param {string[]} userIds
 */
export function buildDeleteSql(userIds) {
  if (userIds.length === 0) {
    throw new Error("Refusing to build a DELETE with no user ids.");
  }
  const idList = userIds.map(quoteString).join(", ");
  return [
    "DELETE FROM user_plan",
    `WHERE user_id IN (${idList})`,
    `AND user_id IN (SELECT id FROM "user" WHERE ${testUserPredicate()});`,
  ].join(" ");
}

/**
 * @param {string} output
 * @returns {D1Result}
 */
export function parseWranglerJson(output) {
  const parsed = JSON.parse(output);
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  /** @type {D1Row[]} */
  const rows = [];
  /** @type {number | null} */
  let changes = null;
  for (const statement of statements) {
    const results = Array.isArray(statement?.results)
      ? statement.results
      : Array.isArray(statement?.result?.results)
        ? statement.result.results
        : Array.isArray(statement?.result?.[0]?.results)
          ? statement.result[0].results
          : [];
    rows.push(...results);
    const meta = statement?.meta ?? statement?.result?.meta ?? statement?.result?.[0]?.meta;
    if (typeof meta?.changes === "number") {
      changes = (changes ?? 0) + meta.changes;
    }
  }
  return { changes, rows };
}

/**
 * @param {Input} input
 * @param {string} sql
 * @returns {D1Result}
 */
function runWranglerSql(input, sql) {
  const args = [
    "wrangler",
    "d1",
    "execute",
    input.databaseName,
    input.remote ? "--remote" : "--local",
    "--json",
    "--command",
    sql,
  ];
  const result = spawnSync("npx", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.error) {
    throw new Error(`wrangler d1 execute could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(`wrangler d1 execute failed${message ? `: ${message}` : ""}`);
  }
  return parseWranglerJson(result.stdout);
}

/**
 * @param {D1Row[]} rows
 * @returns {TestPlanRow[]}
 */
function toTestPlanRows(rows) {
  return rows.map((row) => ({
    email: String(row.email ?? ""),
    plan: String(row.plan ?? ""),
    plan_updated_at: String(row.plan_updated_at ?? ""),
    user_id: String(row.user_id ?? ""),
  }));
}

/**
 * @param {D1Row[]} rows
 */
function firstCount(rows) {
  const value = rows[0]?.count;
  return typeof value === "number" ? value : Number(value ?? 0);
}

/**
 * @param {Input} input
 */
function listTestPlanRows(input) {
  return toTestPlanRows(runWranglerSql(input, buildListSql()).rows);
}

/**
 * @param {Input} input
 * @param {Record<string, unknown>} extra
 */
function summary(input, extra) {
  return {
    database: input.databaseName,
    domain: TEST_EMAIL_DOMAIN,
    mode: input.mode,
    table: "user_plan",
    target: input.remote ? "remote" : "local",
    ...extra,
  };
}

/**
 * @param {Input} input
 * @returns {number} exit code
 */
function runDryRun(input) {
  const rows = listTestPlanRows(input);
  console.log(JSON.stringify(summary(input, { matched: rows.length, rows }), null, 2));
  console.log(
    `Dry run: ${rows.length} user_plan row(s) belong to ${TEST_EMAIL_DOMAIN} users. Nothing was deleted.`,
  );
  return 0;
}

/**
 * @param {Input} input
 * @returns {number} exit code
 */
function runApply(input) {
  if (input.remote && process.env.SAFE_DEPLOY_APPROVED !== "d1") {
    throw new Error("Deleting from remote D1 requires SAFE_DEPLOY_APPROVED=d1.");
  }

  const rows = listTestPlanRows(input);
  if (rows.length === 0) {
    console.log(JSON.stringify(summary(input, { deleted: 0, matched: 0, remaining: 0, rows }), null, 2));
    console.log(`No user_plan rows belong to ${TEST_EMAIL_DOMAIN} users. Nothing to delete.`);
    return 0;
  }

  const userIds = rows.map((row) => row.user_id);
  const { changes } = runWranglerSql(input, buildDeleteSql(userIds));
  const remaining = firstCount(runWranglerSql(input, buildCountSql()).rows);
  const deleted = changes ?? rows.length - remaining;

  console.log(
    JSON.stringify(summary(input, { deleted, matched: rows.length, remaining, rows }), null, 2),
  );

  if (remaining !== 0) {
    console.error(`Purge incomplete: ${remaining} ${TEST_EMAIL_DOMAIN} user_plan row(s) remain.`);
    return 1;
  }
  if (deleted !== rows.length) {
    console.error(`Purge mismatch: listed ${rows.length} row(s) but D1 reported ${deleted} change(s).`);
    return 1;
  }
  console.log(`Deleted ${deleted} user_plan row(s) belonging to ${TEST_EMAIL_DOMAIN} users.`);
  return 0;
}

/**
 * @param {Input} input
 * @returns {number} exit code
 */
function runCheck(input) {
  const rows = listTestPlanRows(input);
  if (rows.length > 0) {
    console.error(JSON.stringify(summary(input, { matched: rows.length, rows }), null, 2));
    console.error(
      `check:d1:no-test-plans failed: ${rows.length} user_plan row(s) still belong to ${TEST_EMAIL_DOMAIN} users. Run: node scripts/d1-purge-test-plans.mjs --dry-run`,
    );
    return 1;
  }
  console.log(`check:d1:no-test-plans passed: no user_plan rows belong to ${TEST_EMAIL_DOMAIN} users.`);
  return 0;
}

function main() {
  let input;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Usage: node scripts/d1-purge-test-plans.mjs [--dry-run | --apply | --check] [--remote | --local] [--database <name>]");
    process.exit(2);
  }

  try {
    const runners = { apply: runApply, check: runCheck, "dry-run": runDryRun };
    process.exitCode = runners[input.mode](input);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
