import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { sha256CanonicalJson } from "./d1-backup-lifecycle-canary.mjs";
import {
  POST_DEPLOY_CLEANUP_MIGRATIONS,
  PRODUCTION_MIGRATION_LEDGER_BASELINE_SHA256,
  allowedProductionMigrationLedgers,
  migrationLedgerNamesSha256,
} from "./d1-migration-sync-check.lib.mjs";

const APPROVAL_MARKER = "0509-remote-restore-evidence";
const REPOSITORY = "nish3451/0509";
const STALE_SCRATCH_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SQL_BYTES = 256 * 1024 * 1024;
const MIN_MAX_SQL_BYTES = 16 * 1024 * 1024;
const MAX_MAX_SQL_BYTES = 480 * 1024 * 1024;

export const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * @typedef {{
 *   integrity: string,
 *   foreignKeyViolations: number,
 *   rowCounts: Array<{ table: string, count: number }>,
 *   rowCountDigestSha256: string,
 *   schemaDigestSha256: string,
 *   contentDigestSha256: string,
 *   migrationLedger: Array<{
 *     id: number,
 *     name: string,
 *     appliedAt: string,
 *   }>,
 *   migrationLedgerSha256: string,
 *   planRowCount: number,
 *   dodoLinkedPlanRowCount: number,
 * }} DatabaseEvidence
 */

/**
 * @typedef {{
 *   name: string,
 *   uuid: string,
 *   createdAt: string | null,
 * }} ListedDatabase
 */

/** @param {Buffer | string} value */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} exportedSql @param {string} downloadedSql */
export function assertExactR2Backup(exportedSql, downloadedSql) {
  if (sha256(downloadedSql) !== sha256(exportedSql)) {
    throw new Error("fresh_r2_backup_hash_mismatch");
  }
  return true;
}

/** @param {Record<string, string | undefined>} env */
export function resolveMaxSqlBytes(env = process.env) {
  const configured = env.D1_REMOTE_RESTORE_MAX_SQL_BYTES?.trim();
  if (!configured) return DEFAULT_MAX_SQL_BYTES;
  if (!/^[1-9][0-9]{6,10}$/u.test(configured)) {
    throw new Error("remote_restore_max_sql_bytes_invalid");
  }
  const bytes = Number(configured);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < MIN_MAX_SQL_BYTES ||
    bytes > MAX_MAX_SQL_BYTES
  ) {
    throw new Error("remote_restore_max_sql_bytes_invalid");
  }
  return bytes;
}

/**
 * Treat provider creation as attempted before the create call so a successful
 * mutation followed by malformed provider output still triggers exact cleanup.
 * @template Created
 * @template Result
 * @param {{
 *   create: () => Promise<Created>,
 *   use: (created: Created) => Promise<Result>,
 *   remove: () => Promise<unknown>,
 * }} operations
 */
export async function withScratchCleanup({ create, use, remove }) {
  /** @type {Created | undefined} */
  let created;
  /** @type {Result | undefined} */
  let result;
  let primaryError = null;
  try {
    created = await create();
    result = await use(created);
  } catch (error) {
    primaryError = error;
  }

  /** @type {unknown[]} */
  const cleanupErrors = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await remove();
      if (primaryError) throw primaryError;
      return {
        created: /** @type {Created} */ (created),
        result: /** @type {Result} */ (result),
        scratchRemoved: true,
      };
    } catch (error) {
      if (error === primaryError) throw error;
      cleanupErrors.push(error);
    }
  }
  throw new AggregateError(
    primaryError
      ? [primaryError, ...cleanupErrors]
      : cleanupErrors,
    primaryError
      ? "scratch_database_cleanup_failed_after_restore_failure"
      : "scratch_database_cleanup_failed_after_restore_success",
    { cause: primaryError ?? cleanupErrors[0] },
  );
}

/** @param {string} value */
function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/** @param {Record<string, string | undefined>} env */
export function assertAutomationContext(env = process.env) {
  const runId = env.GITHUB_RUN_ID?.trim() ?? "";
  const runAttempt = env.GITHUB_RUN_ATTEMPT?.trim() || "1";
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.D1_REMOTE_RESTORE_AUTOMATION_APPROVED !== APPROVAL_MARKER ||
    !/^[1-9][0-9]{4,19}$/u.test(runId) ||
    !/^[1-9][0-9]{0,5}$/u.test(runAttempt)
  ) {
    throw new Error("remote_restore_automation_not_approved");
  }
  return { runId, runAttempt };
}

/** @param {string} runId @param {string} runAttempt */
export function buildScratchDatabaseName(runId, runAttempt) {
  if (
    !/^[1-9][0-9]{4,19}$/u.test(runId) ||
    !/^[1-9][0-9]{0,5}$/u.test(runAttempt)
  ) {
    throw new Error("remote_restore_run_identity_invalid");
  }
  const name = `0509-restore-test-${runId}-${runAttempt}`;
  if (name.length > 63) throw new Error("remote_restore_run_identity_invalid");
  return name;
}

/**
 * @param {ListedDatabase[]} databases
 * @param {string} runId
 */
export function currentRunScratchDatabaseNames(databases, runId) {
  if (
    !Array.isArray(databases) ||
    !/^[1-9][0-9]{4,19}$/u.test(runId)
  ) {
    throw new Error("scratch_database_current_run_input_invalid");
  }
  const prefix = `0509-restore-test-${runId}-`;
  return databases
    .map((database) => database?.name ?? "")
    .filter(
      (name) =>
        name.startsWith(prefix) &&
        /^[1-9][0-9]{0,5}$/u.test(name.slice(prefix.length)),
    )
    .sort();
}

/** @param {string} output @returns {any} */
export function parseWranglerJson(output) {
  const lines = String(output).split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimStart();
    if (!line.startsWith("[") && !line.startsWith("{")) continue;
    try {
      return JSON.parse(lines.slice(index).join("\n"));
    } catch {
      // Wrangler can print non-JSON progress before its final machine payload.
    }
  }
  throw new Error("wrangler_json_missing");
}

/** @param {string} output */
export function parseCreatedDatabaseUuid(output) {
  const match = String(output).match(
    /["']?database_id["']?\s*[:=]\s*["']([a-f0-9-]+)["']/iu,
  );
  const uuid = match?.[1]?.toLowerCase() ?? "";
  if (!UUID_PATTERN.test(uuid)) throw new Error("scratch_database_id_missing");
  return uuid;
}

/** @param {DatabaseEvidence} source @param {DatabaseEvidence} restored */
export function assertRestoreRoundTrip(source, restored) {
  if (source.integrity !== "ok" || restored.integrity !== "ok") {
    throw new Error("scratch_restore_integrity_failed");
  }
  if (
    source.foreignKeyViolations !== 0 ||
    restored.foreignKeyViolations !== 0
  ) {
    throw new Error("scratch_restore_foreign_keys_failed");
  }
  if (JSON.stringify(source.rowCounts) !== JSON.stringify(restored.rowCounts)) {
    throw new Error("scratch_restore_row_counts_mismatch");
  }
  if (source.schemaDigestSha256 !== restored.schemaDigestSha256) {
    throw new Error("scratch_restore_schema_mismatch");
  }
  if (source.contentDigestSha256 !== restored.contentDigestSha256) {
    throw new Error("scratch_restore_content_mismatch");
  }
  if (
    JSON.stringify(source.migrationLedger) !==
    JSON.stringify(restored.migrationLedger)
  ) {
    throw new Error("scratch_restore_migration_ledger_mismatch");
  }
  if (
    source.planRowCount !== restored.planRowCount ||
    source.dodoLinkedPlanRowCount !== restored.dodoLinkedPlanRowCount
  ) {
    throw new Error("scratch_restore_release_linkage_mismatch");
  }
  return true;
}

/**
 * Require the complete ordered D1 ledger to equal the repository migration
 * set. Comparing only the latest name can hide a missing earlier migration.
 * @param {DatabaseEvidence["migrationLedger"]} ledger
 * @param {string[]} repositoryMigrations
 * @param {Set<string>} cleanupMigrations
 * @param {{ baseline?: readonly string[], retiredMigrations?: Set<string> }} options
 */
export function assertMigrationLedgerMatchesRepository(
  ledger,
  repositoryMigrations,
  cleanupMigrations = POST_DEPLOY_CLEANUP_MIGRATIONS,
  options = {},
) {
  const ledgerNames = ledger.map((entry) => entry.name);
  const allowedLedgers = allowedProductionMigrationLedgers(
    repositoryMigrations,
    cleanupMigrations,
    options.baseline,
    options.retiredMigrations,
  );
  if (
    !allowedLedgers.some(
      (allowedLedger) =>
        JSON.stringify(ledgerNames) === JSON.stringify(allowedLedger),
    )
  ) {
    throw new Error("source_backup_migration_ledger_stale");
  }
  return true;
}

/**
 * @param {{ binding?: string, name?: string, uuid?: string } | null | undefined} configuredDatabase
 * @param {{ name?: string, uuid?: string } | null | undefined} productionDatabase
 */
export function assertConfiguredProductionDatabase(
  configuredDatabase,
  productionDatabase,
) {
  if (
    configuredDatabase?.binding !== "DB" ||
    configuredDatabase?.name !== "0509" ||
    !UUID_PATTERN.test(configuredDatabase?.uuid ?? "") ||
    productionDatabase?.name !== configuredDatabase.name ||
    productionDatabase?.uuid !== configuredDatabase.uuid
  ) {
    throw new Error("production_database_binding_identity_mismatch");
  }
  return true;
}

/**
 * @param {{
 *   candidate: Record<string, any>,
 *   aggregate: DatabaseEvidence,
 *   sourceDumpSha256: string,
 *   transformedSqlSha256: string,
 *   productionDatabase: { name: string, uuid: string },
 *   scratchDatabase: { name: string, uuid: string },
 *   databaseBookmark: string,
 *   latestMigration: string,
 *   migrationCount: number,
 *   generatedAt?: string,
 *   scratchDatabaseRemoved: boolean,
 * }} input
 */
export function buildRemoteRestoreEvidence({
  candidate,
  aggregate,
  sourceDumpSha256,
  transformedSqlSha256,
  productionDatabase,
  scratchDatabase,
  databaseBookmark,
  latestMigration,
  migrationCount,
  generatedAt = new Date().toISOString(),
  scratchDatabaseRemoved,
}) {
  assertConfiguredProductionDatabase(
    candidate?.wrangler?.worktreeD1Database,
    productionDatabase,
  );
  if (
    !SHA256_PATTERN.test(candidate?.fingerprint ?? "") ||
    !SHA256_PATTERN.test(candidate?.wrangler?.worktreeSha256 ?? "") ||
    candidate?.wrangler?.worktreeSearchRolloutMode !== "v2" ||
    !SHA256_PATTERN.test(sourceDumpSha256) ||
    !SHA256_PATTERN.test(transformedSqlSha256) ||
    !UUID_PATTERN.test(productionDatabase?.uuid ?? "") ||
    !UUID_PATTERN.test(scratchDatabase?.uuid ?? "") ||
    typeof databaseBookmark !== "string" ||
    databaseBookmark.trim().length < 6 ||
    typeof latestMigration !== "string" ||
    !Number.isInteger(migrationCount) ||
    migrationCount < 1 ||
    latestMigration !== aggregate.migrationLedger.at(-1)?.name ||
    migrationCount !== aggregate.migrationLedger.length ||
    scratchDatabaseRemoved !== true
  ) {
    throw new Error("remote_restore_evidence_input_invalid");
  }
  const migrationLedgerNames = aggregate.migrationLedger.map(
    (entry) => entry.name,
  );
  return {
    schemaVersion: 2,
    candidateFingerprint: candidate.fingerprint,
    generatedAt,
    databaseIdentitySha256: sha256CanonicalJson(productionDatabase),
    databaseBookmark,
    scratchDatabaseIdentitySha256: sha256CanonicalJson(scratchDatabase),
    sourceDumpSha256,
    transformedSqlSha256,
    rowCountDigestSha256: aggregate.rowCountDigestSha256,
    migrationLedgerSha256: aggregate.migrationLedgerSha256,
    migrationLedgerBaselineSha256:
      PRODUCTION_MIGRATION_LEDGER_BASELINE_SHA256,
    migrationLedgerNames,
    migrationLedgerNamesSha256:
      migrationLedgerNamesSha256(migrationLedgerNames),
    schemaDigestSha256: aggregate.schemaDigestSha256,
    contentDigestSha256: aggregate.contentDigestSha256,
    wranglerWorktreeSha256: candidate.wrangler.worktreeSha256,
    latestMigration,
    migrationCount,
    planRowCount: aggregate.planRowCount,
    dodoLinkedPlanRowCount: aggregate.dodoLinkedPlanRowCount,
    productionSearchRolloutMode: "v2",
    integrity: aggregate.integrity,
    foreignKeyViolations: aggregate.foreignKeyViolations,
    exactRowCounts: true,
    dodoLinkagePreserved:
      aggregate.dodoLinkedPlanRowCount >= 0 &&
      aggregate.dodoLinkedPlanRowCount <= aggregate.planRowCount,
    scratchDatabaseRemoved: true,
  };
}

/**
 * @param {string} databasePath
 * @param {string} sql
 * @param {{ maxBytes?: number }} options
 */
export function importSqlite(
  databasePath,
  sql,
  { maxBytes = resolveMaxSqlBytes() } = {},
) {
  if (Buffer.byteLength(sql) > maxBytes) {
    throw new Error("scratch_restore_import_failed");
  }
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: false,
  });
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}

/** @param {unknown} value */
function canonicalSqlValue(value) {
  if (value === null) return { type: "null" };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    return {
      type: "blob",
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    };
  }
  if (typeof value === "bigint") {
    return { type: "integer", value: value.toString() };
  }
  if (typeof value === "number") {
    return {
      type: Number.isInteger(value) ? "integer" : "real",
      value: Object.is(value, -0) ? "-0" : String(value),
    };
  }
  return { type: "text", value: String(value) };
}

/** @param {string} databasePath @returns {DatabaseEvidence} */
export function collectDatabaseEvidence(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = String(
      Object.values(
        database.prepare("PRAGMA integrity_check").get() ?? {},
      )[0] ?? "",
    );
    const foreignKeyViolations = database
      .prepare("PRAGMA foreign_key_check")
      .all().length;
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    const rowCounts = tables.map((table) => ({
      table,
      count: Number(
        database
          .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
          .get()?.count ?? 0,
      ),
    }));
    const schema = database
      .prepare(
        `SELECT type, name, tbl_name, COALESCE(sql, '') AS sql
           FROM sqlite_schema
          WHERE name NOT LIKE 'sqlite_%'
          ORDER BY type, name, tbl_name`,
      )
      .all()
      .map((row) => ({
        type: String(row.type),
        name: String(row.name),
        table: String(row.tbl_name),
        sql: String(row.sql),
      }));
    const tableContent = tables.map((table) => {
      const columns = database
        .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
        .all()
        .map((row) => String(row.name));
      /** @type {string[]} */
      const rowHashes = [];
      const contentStatement = database.prepare(
        `SELECT * FROM ${quoteIdentifier(table)}`,
      );
      contentStatement.setReadBigInts(true);
      for (const row of contentStatement.iterate()) {
        rowHashes.push(
          sha256CanonicalJson(
            columns.map((column) => [
              column,
              canonicalSqlValue(row[column]),
            ]),
          ),
        );
      }
      rowHashes.sort();
      return {
        table,
        columns,
        rows: rowHashes.length,
        digestSha256: sha256CanonicalJson(rowHashes),
      };
    });
    const migrationLedger = database
      .prepare(
        "SELECT id, name, applied_at FROM d1_migrations ORDER BY id",
      )
      .all()
      .map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        appliedAt: String(row.applied_at),
      }));
    const plan = database
      .prepare(
        `SELECT COUNT(*) AS plan_row_count,
                SUM(dodo_payment_id IS NOT NULL
                    OR dodo_subscription_id IS NOT NULL
                    OR dodo_customer_id IS NOT NULL) AS linked_row_count
           FROM user_plan`,
      )
      .get();
    return {
      integrity,
      foreignKeyViolations,
      rowCounts,
      rowCountDigestSha256: sha256CanonicalJson(rowCounts),
      schemaDigestSha256: sha256CanonicalJson(schema),
      contentDigestSha256: sha256CanonicalJson(tableContent),
      migrationLedger,
      migrationLedgerSha256: sha256CanonicalJson(migrationLedger),
      planRowCount: Number(plan?.plan_row_count ?? 0),
      dodoLinkedPlanRowCount: Number(plan?.linked_row_count ?? 0),
    };
  } finally {
    database.close();
  }
}

/** @param {unknown} payload @returns {ListedDatabase[]} */
export function databaseList(payload) {
  if (!Array.isArray(payload)) throw new Error("d1_database_list_invalid");
  return payload.map((entry) => ({
    name: String(entry?.name ?? ""),
    uuid: String(entry?.uuid ?? entry?.id ?? "").toLowerCase(),
    createdAt:
      typeof entry?.created_at === "string"
        ? entry.created_at
        : null,
  }));
}

/**
 * @param {Array<{
 *   name: string,
 *   createdAt: string | null,
 *   uuid?: string,
 * }>} databases
 * @param {Date} now
 */
export function staleScratchDatabaseNames(databases, now = new Date()) {
  const nowMs = now.getTime();
  if (!Array.isArray(databases) || !Number.isFinite(nowMs)) {
    throw new Error("scratch_database_sweep_input_invalid");
  }
  return databases
    .filter((database) =>
      /^0509-restore-test-[1-9][0-9]{4,19}-[1-9][0-9]{0,5}$/u.test(
        database?.name ?? "",
      ),
    )
    .filter((database) => {
      const createdAt = Date.parse(database?.createdAt ?? "");
      return (
        Number.isFinite(createdAt) &&
        createdAt <= nowMs - STALE_SCRATCH_AGE_MS
      );
    })
    .map((database) => database.name)
    .sort();
}

/** @param {unknown} payload */
export function extractBookmark(payload) {
  const entries = Array.isArray(payload) ? payload : [payload];
  const bookmark = entries.find(
    (entry) =>
      entry?.success === true &&
      typeof entry?.finalBookmark === "string" &&
      entry.finalBookmark.length >= 6,
  )?.finalBookmark;
  if (!bookmark) throw new Error("scratch_database_bookmark_missing");
  return bookmark;
}
