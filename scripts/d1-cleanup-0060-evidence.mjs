#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DATABASE_NAME = "0509";
export const CLEANUP_MIGRATION = "0060_remove_legacy_billing_provider.sql";

const RETIRED_PROVIDER_PREFIX = "razor" + "pay";
export const RETIRED_WEBHOOK_TABLE = `${RETIRED_PROVIDER_PREFIX}_webhook_event`;
export const RETIRED_USER_PLAN_COLUMNS = [
  `${RETIRED_PROVIDER_PREFIX}_customer_id`,
  `${RETIRED_PROVIDER_PREFIX}_subscription_id`,
  `${RETIRED_PROVIDER_PREFIX}_plan_id`,
  `${RETIRED_PROVIDER_PREFIX}_status`,
];
export const LEGACY_BILLING_USER_PLAN_COLUMNS = [
  "stripe_customer_id",
  "stripe_subscription_id",
  ...RETIRED_USER_PLAN_COLUMNS,
];
export const LIVE_DODO_COLUMNS = [
  "dodo_payment_id",
  "dodo_product_id",
  "dodo_status",
  "dodo_subscription_id",
  "dodo_customer_id",
  "dodo_next_billing_at",
];
export const DODO_LINKAGE_COLUMNS = [
  "dodo_payment_id",
  "dodo_subscription_id",
  "dodo_customer_id",
];

/**
 * @typedef {"pre" | "post"} EvidenceStage
 * @typedef {{ databaseName: string, remote: boolean, stage: EvidenceStage }} EvidenceInput
 * @typedef {Record<string, unknown>} D1Row
 * @typedef {{
 *   legacyBillingColumnsPresent?: number,
 *   retiredProviderColumnsPresent: number,
 *   retiredProviderWebhookTablePresent: boolean,
 *   stage: string,
 * }} StageEvidence
 */

/**
 * @param {string[]} argv
 * @returns {EvidenceInput}
 */
function parseArgs(argv) {
  const args = new Set(argv);
  const stageIndex = argv.indexOf("--stage");
  const stage = stageIndex >= 0 ? argv[stageIndex + 1] : "pre";
  if (!["pre", "post"].includes(stage)) {
    throw new Error("Use --stage pre or --stage post.");
  }

  return {
    databaseName: valueAfter(argv, "--database") ?? DATABASE_NAME,
    remote: args.has("--remote"),
    stage: /** @type {EvidenceStage} */ (stage),
  };
}

/**
 * @param {string[]} argv
 * @param {string} flag
 * @returns {string | null}
 */
function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

/**
 * @param {string[]} columns
 */
export function buildDodoLinkageCountSql(columns = DODO_LINKAGE_COLUMNS) {
  const predicates = columns.map((column) => `${quoteIdentifier(column)} IS NOT NULL`).join(" OR ");
  return `SELECT COUNT(*) AS count FROM user_plan WHERE ${predicates};`;
}

export function buildPlanDistributionSql() {
  return "SELECT plan, COUNT(*) AS count FROM user_plan GROUP BY plan ORDER BY plan;";
}

/**
 * @param {string} column
 */
export function buildRetiredColumnCountSql(column) {
  if (!RETIRED_USER_PLAN_COLUMNS.includes(column)) {
    throw new Error(`Unsupported retired column: ${column}`);
  }
  return `SELECT COUNT(*) AS count FROM user_plan WHERE ${quoteIdentifier(column)} IS NOT NULL AND ${quoteIdentifier(
    column,
  )} <> '';`;
}

/**
 * @param {string} tableName
 */
export function buildTableExistsSql(tableName) {
  return `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ${quoteString(tableName)};`;
}

/**
 * @param {string} tableName
 */
export function buildTableRowCountSql(tableName) {
  if (tableName !== RETIRED_WEBHOOK_TABLE) {
    throw new Error(`Unsupported table: ${tableName}`);
  }
  return `SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)};`;
}

/**
 * @param {string} value
 */
function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

/**
 * @param {string} value
 */
function quoteString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * @param {EvidenceInput} input
 * @param {string} sql
 * @returns {D1Row[]}
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
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(`wrangler d1 execute failed${message ? `: ${message}` : ""}`);
  }

  return rowsFromWranglerJson(result.stdout);
}

/**
 * @param {string} output
 * @returns {D1Row[]}
 */
export function rowsFromWranglerJson(output) {
  const parsed = JSON.parse(output);
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  const rows = statements.flatMap((statement) => {
    if (Array.isArray(statement?.results)) return statement.results;
    if (Array.isArray(statement?.result?.results)) return statement.result.results;
    if (Array.isArray(statement?.result?.[0]?.results)) return statement.result[0].results;
    return [];
  });
  return rows;
}

/**
 * @param {D1Row[]} rows
 */
function firstCount(rows) {
  const value = rows[0]?.count;
  return typeof value === "number" ? value : Number(value ?? 0);
}

/**
 * @param {EvidenceInput} input
 */
function collectEvidence(input) {
  if (input.remote && process.env.SAFE_DEPLOY_APPROVED !== "d1") {
    throw new Error("Remote D1 evidence requires SAFE_DEPLOY_APPROVED=d1.");
  }

  const userPlanRows = firstCount(runWranglerSql(input, "SELECT COUNT(*) AS count FROM user_plan;"));
  const planDistribution = runWranglerSql(input, buildPlanDistributionSql()).map((row) => ({
    count: Number(row.count ?? 0),
    plan: String(row.plan ?? "unknown"),
  }));
  const userPlanColumns = runWranglerSql(input, "PRAGMA table_info(user_plan);").map((row) =>
    String(row.name),
  );
  const presentRetiredColumns = RETIRED_USER_PLAN_COLUMNS.filter((column) =>
    userPlanColumns.includes(column),
  );
  const presentLegacyBillingColumns = LEGACY_BILLING_USER_PLAN_COLUMNS.filter((column) =>
    userPlanColumns.includes(column),
  );
  const retiredColumnCounts = Object.fromEntries(
    presentRetiredColumns.map((column) => [
      column.replace(RETIRED_PROVIDER_PREFIX, "retired_provider"),
      firstCount(runWranglerSql(input, buildRetiredColumnCountSql(column))),
    ]),
  );
  const retiredWebhookTableExists = firstCount(runWranglerSql(input, buildTableExistsSql(RETIRED_WEBHOOK_TABLE))) > 0;
  const retiredWebhookRows = retiredWebhookTableExists
    ? firstCount(runWranglerSql(input, buildTableRowCountSql(RETIRED_WEBHOOK_TABLE)))
    : 0;
  const dodoColumnsPresent = DODO_LINKAGE_COLUMNS.filter((column) => userPlanColumns.includes(column));
  const dodoLinkageRows =
    dodoColumnsPresent.length > 0
      ? firstCount(runWranglerSql(input, buildDodoLinkageCountSql(dodoColumnsPresent)))
      : 0;

  return {
    database: input.databaseName,
    dodoLinkageRows,
    migration: CLEANUP_MIGRATION,
    mode: input.remote ? "remote" : "local",
    planDistribution,
    legacyBillingColumnsPresent: presentLegacyBillingColumns.length,
    legacyBillingSchemaFieldsPresent: presentLegacyBillingColumns.map(maskBillingSchemaName),
    retiredProviderColumnsPresent: presentRetiredColumns.length,
    retiredProviderNonNullCounts: retiredColumnCounts,
    retiredProviderWebhookRows: retiredWebhookRows,
    retiredProviderWebhookTablePresent: retiredWebhookTableExists,
    stage: input.stage,
    userPlanRows,
    userPlanSchema: userPlanColumns.map(maskBillingSchemaName),
  };
}

/**
 * @param {string} column
 */
function maskBillingSchemaName(column) {
  return RETIRED_USER_PLAN_COLUMNS.includes(column)
    ? column.replace(RETIRED_PROVIDER_PREFIX, "retired_provider")
    : column;
}

/**
 * @param {StageEvidence} evidence
 * @returns {string[]}
 */
export function validateStageEvidence(evidence) {
  if (evidence.stage !== "post") {
    return [];
  }

  /** @type {string[]} */
  const failures = [];
  if (typeof evidence.legacyBillingColumnsPresent === "number" && evidence.legacyBillingColumnsPresent !== 0) {
    failures.push("legacy billing columns are still present");
  }
  if (evidence.retiredProviderColumnsPresent !== 0) {
    failures.push("retired provider columns are still present");
  }
  if (evidence.retiredProviderWebhookTablePresent) {
    failures.push("retired provider webhook table is still present");
  }
  return failures;
}

function main() {
  const input = parseArgs(process.argv.slice(2));
  const evidence = collectEvidence(input);
  console.log(JSON.stringify(evidence, null, 2));
  const failures = validateStageEvidence(evidence);
  if (failures.length > 0) {
    console.error(`Post-cleanup evidence failed: ${failures.join("; ")}.`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
