#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKUP_BUCKET_NAME,
  buildR2GetArgs,
  resolveBackupLocalDirectory,
} from "./d1-backup-command-args.mjs";
import {
  DEFAULT_MAX_STATEMENT_BYTES,
  transformD1RestoreSql,
} from "./d1-restore-transform.mjs";
import {
  allowedProductionMigrationLedgers,
  migrationLedgerState,
} from "./d1-migration-sync-check.lib.mjs";
import { validateRemoteRestoreEvidence } from "./deploy-production-plan.mjs";
import { redactSensitiveOutput } from "./safe-command-output.mjs";
import {
  UUID_PATTERN,
  assertAutomationContext,
  assertConfiguredProductionDatabase,
  assertExactR2Backup,
  assertMigrationLedgerMatchesRepository,
  assertRestoreRoundTrip,
  buildRemoteRestoreEvidence,
  buildScratchDatabaseName,
  collectDatabaseEvidence,
  currentRunScratchDatabaseNames,
  databaseList,
  extractBookmark,
  importSqlite,
  parseCreatedDatabaseUuid,
  parseWranglerJson,
  planSourceBackupLedgerReconciliation,
  resolveMaxSqlBytes,
  sha256,
  staleScratchDatabaseNames,
  withScratchCleanup,
} from "./d1-remote-restore-evidence-core.mjs";

export {
  assertAutomationContext,
  assertConfiguredProductionDatabase,
  assertExactR2Backup,
  assertMigrationLedgerMatchesRepository,
  assertRestoreRoundTrip,
  buildRemoteRestoreEvidence,
  buildScratchDatabaseName,
  collectDatabaseEvidence,
  currentRunScratchDatabaseNames,
  parseCreatedDatabaseUuid,
  parseWranglerJson,
  planSourceBackupLedgerReconciliation,
  resolveMaxSqlBytes,
  staleScratchDatabaseNames,
  unappliedForwardMigrationSuffix,
  withScratchCleanup,
} from "./d1-remote-restore-evidence-core.mjs";

const PRODUCTION_DATABASE_NAME = "0509";
const SCRATCH_BINDING = "RESTORE_DB";
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
const LONG_COMMAND_TIMEOUT_MS = 240 * 60 * 1000;
const FORCE_KILL_DELAY_MS = 5_000;
const STALE_LOCAL_RESTORE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Preserve the fail-closed error while exposing only migration filenames
 * needed to reconcile an append-only production ledger.
 *
 * @param {unknown} error
 * @param {Array<{ name: string }>} ledger
 * @param {string[]} repositoryMigrations
 * @param {(message: string) => void} write
 * @returns {never}
 */
export function rethrowWithMigrationLedgerDiagnostics(
  error,
  ledger,
  repositoryMigrations,
  write = console.error,
) {
  if (
    error instanceof Error &&
    error.message === "source_backup_migration_ledger_stale"
  ) {
    write(
      `source_backup_migration_ledger_names:${JSON.stringify(
        ledger.map((entry) => entry.name),
      )}`,
    );
    write(
      `repository_migration_names:${JSON.stringify(repositoryMigrations)}`,
    );
  }
  throw error;
}

const FORWARD_MIGRATION_NAME_PATTERN = /^\d{4}_[A-Za-z0-9_]+\.sql$/u;

/**
 * Apply a contiguous unapplied repository suffix so the next backup ledger
 * can match the repo. Used when push/schedule restore-evidence skips the
 * dispatch-only apply_and_restore job (#1152).
 *
 * @param {string[]} migrations
 * @param {typeof runCaptured} runCommand
 * @param {(message: string) => void} write
 */
export async function applyForwardMigrationSuffix(
  migrations,
  runCommand = runCaptured,
  write = console.error,
) {
  if (
    !Array.isArray(migrations) ||
    migrations.length === 0 ||
    migrations.some((name) => !FORWARD_MIGRATION_NAME_PATTERN.test(name)) ||
    new Set(migrations).size !== migrations.length
  ) {
    throw new Error("forward_migration_catchup_invalid");
  }
  write(`forward_migration_catchup:${JSON.stringify(migrations)}`);
  await runCommand(
    "npx",
    [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      PRODUCTION_DATABASE_NAME,
      "--remote",
    ],
    { timeoutMs: LONG_COMMAND_TIMEOUT_MS },
  );
  return true;
}

/**
 * Capture raw stdout only in memory while writing redacted output to Actions.
 * @param {string} command
 * @param {string[]} args
 * @param {{
 *   quiet?: boolean,
 *   timeoutMs?: number,
 *   env?: Record<string, string>,
 * }} options
 */
export function runCaptured(
  command,
  args,
  {
    quiet = false,
    timeoutMs = COMMAND_TIMEOUT_MS,
    env = {},
  } = {},
) {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 60_000 ||
    timeoutMs > LONG_COMMAND_TIMEOUT_MS
  ) {
    throw new Error("remote_restore_command_timeout_invalid");
  }
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, {
      detached: process.platform !== "win32",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    /** @type {"timeout" | "output" | "signal" | null} */
    let terminationReason = null;
    /** @type {NodeJS.Signals | null} */
    let forwardedSignal = null;
    /** @type {NodeJS.Timeout | null} */
    let forceKillTimer = null;

    /** @param {NodeJS.Signals} signal */
    const signalProcessTree = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The process may have exited between the close check and signal.
        }
      }
    };
    /** @param {"timeout" | "output" | "signal"} reason */
    const requestTermination = (reason) => {
      if (terminationReason) return;
      terminationReason = reason;
      signalProcessTree("SIGTERM");
      forceKillTimer = setTimeout(
        () => signalProcessTree("SIGKILL"),
        FORCE_KILL_DELAY_MS,
      );
    };
    /** @param {NodeJS.Signals} signal */
    const forwardParentSignal = (signal) => {
      if (forwardedSignal) return;
      forwardedSignal = signal;
      requestTermination("signal");
    };
    const onSigint = () => forwardParentSignal("SIGINT");
    const onSigterm = () => forwardParentSignal("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    const clearProcessSignalHandlers = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    const timer = setTimeout(
      () => requestTermination("timeout"),
      timeoutMs,
    );
    let pendingStdout = "";
    let pendingStderr = "";

    /** @param {"stdout" | "stderr"} stream @param {string} chunk */
    const capture = (stream, chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        requestTermination("output");
        return;
      }
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
      if (!quiet) {
        const combined =
          stream === "stdout"
            ? `${pendingStdout}${chunk}`
            : `${pendingStderr}${chunk}`;
        const lines = combined.split("\n");
        const pending = lines.pop() ?? "";
        if (stream === "stdout") pendingStdout = pending;
        else pendingStderr = pending;
        const safe = lines
          .map((line) => `${redactSensitiveOutput(line)}\n`)
          .join("");
        if (stream === "stdout") process.stdout.write(safe);
        else process.stderr.write(safe);
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => capture("stdout", chunk));
    child.stderr?.on("data", (chunk) => capture("stderr", chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      clearProcessSignalHandlers();
      if (forwardedSignal) {
        process.kill(process.pid, forwardedSignal);
        return;
      }
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      clearProcessSignalHandlers();
      if (!quiet) {
        if (pendingStdout) {
          process.stdout.write(redactSensitiveOutput(pendingStdout));
        }
        if (pendingStderr) {
          process.stderr.write(redactSensitiveOutput(pendingStderr));
        }
      }
      if (forwardedSignal) {
        process.kill(process.pid, forwardedSignal);
      } else if (terminationReason === "output") {
        reject(new Error("remote_restore_command_output_too_large"));
      } else if (terminationReason === "timeout") {
        reject(new Error("remote_restore_command_timeout"));
      } else if (signal) {
        reject(new Error("remote_restore_command_terminated"));
      } else if (code !== 0) {
        const error = new Error(`${basename(command)}_failed`);
        Object.defineProperty(error, "safeStderr", {
          value: redactSensitiveOutput(stderr).slice(-8_192),
          enumerable: false,
        });
        reject(error);
      } else {
        resolveExit({ stdout, stderr });
      }
    });
  });
}

/** @param {string} path @param {unknown} value */
function writePrivateJson(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** @param {number} milliseconds */
function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

/**
 * @param {string} scratchName
 * @param {{
 *   listDatabases?: typeof listD1Databases,
 *   wait?: typeof delay,
 * }} dependencies
 */
async function assertScratchAbsent(
  scratchName,
  {
    listDatabases = listD1Databases,
    wait = delay,
  } = {},
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const databases = await listDatabases();
    if (!databases.some((database) => database.name === scratchName)) {
      return databases;
    }
    if (attempt < 4) await wait(2_000);
  }
  throw new Error("scratch_database_still_present");
}

async function listD1Databases() {
  const result = await runCaptured(
    "npx",
    ["wrangler", "d1", "list", "--json"],
    { quiet: true },
  );
  return databaseList(parseWranglerJson(result.stdout));
}

/**
 * @template Result
 * @param {() => Promise<Result>} operation
 * @param {{ wait?: typeof delay }} dependencies
 */
export async function retryCleanupProviderOperation(
  operation,
  { wait = delay } = {},
) {
  const errors = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      errors.push(error);
      if (attempt < 3) await wait(attempt * 2_000);
    }
  }
  throw new AggregateError(
    errors,
    "remote_restore_cleanup_provider_failed",
    { cause: errors[0] },
  );
}

/**
 * @param {string} scratchName
 * @param {{
 *   listDatabases?: typeof listD1Databases,
 *   runCommand?: typeof runCaptured,
 *   wait?: typeof delay,
 * }} dependencies
 */
export async function removeScratchDatabase(
  scratchName,
  {
    listDatabases = listD1Databases,
    runCommand = runCaptured,
    wait = delay,
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "0509-remote-restore-cleanup-"));
  const configPath = join(root, "wrangler-scratch-cleanup.json");
  try {
    const matches = (await listDatabases()).filter(
      (database) => database.name === scratchName,
    );
    if (matches.length > 1) {
      throw new Error("scratch_database_identity_ambiguous");
    }
    if (matches.length === 1) {
      const uuid = matches[0].uuid;
      if (!UUID_PATTERN.test(uuid)) {
        throw new Error("scratch_database_id_missing");
      }
      writePrivateJson(configPath, {
        name: "0509-remote-restore-evidence-cleanup",
        compatibility_date: "2026-03-29",
        d1_databases: [
          {
            binding: SCRATCH_BINDING,
            database_name: scratchName,
            database_id: uuid,
          },
        ],
      });
      await runCommand("npx", [
        "wrangler",
        "d1",
        "delete",
        SCRATCH_BINDING,
        "--skip-confirmation",
        "--config",
        configPath,
      ]);
    }
    await assertScratchAbsent(scratchName, { listDatabases, wait });
    return true;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Attempt every exact scratch deletion before reporting failures.
 * @param {string[]} scratchNames
 * @param {{
 *   removeDatabase?: (scratchName: string) => Promise<unknown>,
 *   wait?: typeof delay,
 * }} dependencies
 */
export async function cleanupScratchDatabaseNames(
  scratchNames,
  {
    removeDatabase = removeScratchDatabase,
    wait = delay,
  } = {},
) {
  if (!Array.isArray(scratchNames)) {
    throw new Error("scratch_database_cleanup_names_invalid");
  }
  const uniqueNames = [...new Set(scratchNames)].sort();
  if (
    uniqueNames.some(
      (name) =>
        !/^0509-restore-test-[1-9][0-9]{4,19}-[1-9][0-9]{0,5}$/u.test(
          name,
        ),
    )
  ) {
    throw new Error("scratch_database_cleanup_names_invalid");
  }
  const errors = [];
  for (const scratchName of uniqueNames) {
    try {
      await retryCleanupProviderOperation(
        () => removeDatabase(scratchName),
        { wait },
      );
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "scratch_database_cleanup_batch_failed",
      { cause: errors[0] },
    );
  }
  return uniqueNames;
}

/**
 * @param {{
 *   listDatabases?: typeof listD1Databases,
 *   removeDatabase?: typeof removeScratchDatabase,
 *   wait?: typeof delay,
 * }} dependencies
 */
export async function sweepStaleScratchDatabases(
  {
    listDatabases = listD1Databases,
    removeDatabase = removeScratchDatabase,
    wait = delay,
  } = {},
) {
  const databases = await retryCleanupProviderOperation(
    () => listDatabases(),
    { wait },
  );
  const staleNames = staleScratchDatabaseNames(databases);
  return cleanupScratchDatabaseNames(staleNames, {
    removeDatabase,
    wait,
  });
}

/** @param {string} directory */
function listBackupFiles(directory) {
  if (!existsSync(directory)) return new Set();
  return new Set(
    readdirSync(directory).filter(
      (name) => name.startsWith("0509-") && name.endsWith(".sql"),
    ),
  );
}

/**
 * Reject oversized SQL before Node allocates a UTF-8 string for it.
 * @param {string} path
 * @param {number} maxBytes
 * @param {string} errorCode
 */
function readSqlFileWithinLimit(path, maxBytes, errorCode) {
  const size = statSync(path).size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes) {
    throw new Error(errorCode);
  }
  const sql = readFileSync(path, "utf8");
  if (!sql.trim() || Buffer.byteLength(sql) > maxBytes) {
    throw new Error(errorCode);
  }
  return sql;
}

/**
 * @param {string} manifestPath
 * @param {string} backupDirectory
 */
export function readOwnedBackupManifest(manifestPath, backupDirectory) {
  const value = JSON.parse(readFileSync(manifestPath, "utf8"));
  const localPath =
    typeof value?.localPath === "string" ? resolve(value.localPath) : "";
  const fileName = basename(localPath);
  const expectedDirectory = resolve(backupDirectory);
  const expectedLocalPath = join(expectedDirectory, fileName);
  const remoteKey =
    typeof value?.remoteKey === "string" ? value.remoteKey : "";
  if (
    value?.schemaVersion !== 1 ||
    !/^0509-[0-9TZ-]+\.sql$/u.test(fileName) ||
    localPath !== expectedLocalPath ||
    remoteKey !== `backups/d1/${fileName}`
  ) {
    throw new Error("remote_restore_backup_manifest_invalid");
  }
  return { fileName, localPath, remoteKey };
}

/** @param {string} localPath */
function removeOwnedLocalBackup(localPath) {
  try {
    unlinkSync(localPath);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : null;
    if (code !== "ENOENT") throw error;
  }
  if (existsSync(localPath)) {
    throw new Error("remote_restore_local_backup_cleanup_incomplete");
  }
}

/**
 * Resolve a temp directory's exact owning backup directory. Actions cleanup
 * can encounter directories from an older run or an earlier attempt, so the
 * current run-scoped directory is only the trusted sibling-directory anchor.
 * @param {string} currentBackupDirectory
 * @param {string} currentRunId
 * @param {string} ownerRunId
 * @param {string} ownerRunAttempt
 */
function resolveOwnedBackupDirectory(
  currentBackupDirectory,
  currentRunId,
  ownerRunId,
  ownerRunAttempt,
) {
  const currentDirectory = resolve(currentBackupDirectory);
  const currentName = basename(currentDirectory);
  const match = currentName.match(
    /^0509-d1-backups-([1-9][0-9]{4,19})-([1-9][0-9]{0,5})$/u,
  );
  if (!match) {
    if (ownerRunId === currentRunId) return currentDirectory;
    throw new Error("remote_restore_backup_directory_context_invalid");
  }
  if (match[1] !== currentRunId) {
    throw new Error("remote_restore_backup_directory_context_invalid");
  }
  return join(
    dirname(currentDirectory),
    `0509-d1-backups-${ownerRunId}-${ownerRunAttempt}`,
  );
}

/**
 * Remove only strict run-scoped temp directories from this run, plus stale
 * strict directories when the independent cleanup job requests a sweep.
 * @param {{
 *   runId: string,
 *   tempDirectory?: string,
 *   backupDirectory?: string,
 *   now?: Date,
 *   sweepStale?: boolean,
 * }} options
 */
export function cleanupLocalRestoreTempDirectories({
  runId,
  tempDirectory = tmpdir(),
  backupDirectory = resolveBackupLocalDirectory(),
  now = new Date(),
  sweepStale = false,
}) {
  if (
    !/^[1-9][0-9]{4,19}$/u.test(runId) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new Error("remote_restore_local_cleanup_input_invalid");
  }
  const pattern =
    /^0509-remote-restore-([1-9][0-9]{4,19})-([1-9][0-9]{0,5})-[A-Za-z0-9]{6}$/u;
  const targets = [];
  const errors = [];
  for (const entry of readdirSync(tempDirectory, { withFileTypes: true })) {
    const match = entry.name.match(pattern);
    if (!match || !entry.isDirectory()) continue;
    const path = join(tempDirectory, entry.name);
    try {
      const stale =
        sweepStale &&
        statSync(path).mtimeMs <=
          now.getTime() - STALE_LOCAL_RESTORE_AGE_MS;
      if (match[1] === runId || stale) {
        targets.push({
          path,
          ownerRunId: match[1],
          ownerRunAttempt: match[2],
        });
      }
    } catch (error) {
      errors.push(error);
    }
  }
  targets.sort((left, right) => left.path.localeCompare(right.path));
  for (const target of targets) {
    const { path, ownerRunId, ownerRunAttempt } = target;
    try {
      const manifestPath = join(path, "backup-local-manifest.json");
      if (existsSync(manifestPath)) {
        const ownedBackup = readOwnedBackupManifest(
          manifestPath,
          resolveOwnedBackupDirectory(
            backupDirectory,
            runId,
            ownerRunId,
            ownerRunAttempt,
          ),
        );
        removeOwnedLocalBackup(ownedBackup.localPath);
      }
      rmSync(path, { recursive: true, force: true });
      if (existsSync(path)) {
        throw new Error("remote_restore_local_temp_cleanup_incomplete");
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "remote_restore_local_temp_cleanup_failed",
      { cause: errors[0] },
    );
  }
  return targets.map(({ path }) => path);
}

/**
 * The owned fresh-backup path is shared between an import call and the
 * runAutomation finally block, so a partial failure after the new backup is
 * created still reaches finally-block cleanup. The state object is mutated in
 * place, mirroring the closure this was extracted from.
 *
 * @typedef {Object} BackupImportState
 * @property {string | null} freshBackupPath
 */

/**
 * Import a fresh D1 backup, verify it round-trips against R2, and collect
 * source evidence. `backupState.freshBackupPath` is cleared before the backup
 * run and reset to the new owned backup path as soon as the manifest is read,
 * so a failure in any later step still lets runAutomation's finally block
 * remove the new backup.
 *
 * The backup script writes the manifest with `flag: "wx"` (exclusive create)
 * to detect stale manifests from prior runs. A second import reuses the same
 * manifest path, so the prior manifest is removed before the run — otherwise
 * the exclusive create throws EEXIST and breaks the deploy-production gate
 * when migration-ledger reconciliation triggers a re-import (#1319).
 *
 * @param {{
 *   knownBackupFiles: Set<string>,
 *   backupState: BackupImportState,
 *   sourceDatabasePath: string,
 *   sourcePath: string,
 *   transformedPath: string,
 *   backupManifestPath: string,
 *   backupDirectory: string,
 *   maxSqlBytes: number,
 *   runBackup: () => Promise<unknown>,
 *   runR2Get: (remoteObjectKey: string) => Promise<unknown>,
 * }} options
 * @returns {Promise<{
 *   aggregate: ReturnType<typeof collectDatabaseEvidence>,
 *   afterBackups: Set<string>,
 *   ownedBackup: ReturnType<typeof readOwnedBackupManifest>,
 *   remoteObjectKey: string,
 *   sourceSql: string,
 *   transformed: ReturnType<typeof transformD1RestoreSql>,
 * }>}
 */
export async function importFreshBackup({
  knownBackupFiles,
  backupState,
  sourceDatabasePath,
  sourcePath,
  transformedPath,
  backupManifestPath,
  backupDirectory,
  maxSqlBytes,
  runBackup,
  runR2Get,
}) {
  if (existsSync(sourceDatabasePath)) {
    unlinkSync(sourceDatabasePath);
  }
  if (backupState.freshBackupPath) {
    removeOwnedLocalBackup(backupState.freshBackupPath);
    backupState.freshBackupPath = null;
  }
  // The backup script creates the manifest with `flag: "wx"` (exclusive
  // create) to detect stale manifests from prior runs. A second import reuses
  // the same manifest path, so the prior manifest must be removed first —
  // otherwise the exclusive create throws EEXIST (#1319).
  rmSync(backupManifestPath, { force: true });
  await runBackup();
  const nextOwnedBackup = readOwnedBackupManifest(
    backupManifestPath,
    backupDirectory,
  );
  backupState.freshBackupPath = nextOwnedBackup.localPath;
  const afterBackups = listBackupFiles(backupDirectory);
  if (
    knownBackupFiles.has(nextOwnedBackup.fileName) ||
    !afterBackups.has(nextOwnedBackup.fileName)
  ) {
    throw new Error("fresh_backup_identity_ambiguous");
  }
  const exportedSql = readSqlFileWithinLimit(
    backupState.freshBackupPath,
    maxSqlBytes,
    "fresh_backup_invalid",
  );
  const remoteObjectKey = nextOwnedBackup.remoteKey;
  await runR2Get(remoteObjectKey);
  const sourceSql = readSqlFileWithinLimit(
    sourcePath,
    maxSqlBytes,
    "fresh_r2_backup_invalid",
  );
  assertExactR2Backup(exportedSql, sourceSql);
  chmodSync(sourcePath, 0o600);
  const transformed = transformD1RestoreSql(sourceSql, {
    maxBytes: DEFAULT_MAX_STATEMENT_BYTES,
  });
  if (Buffer.byteLength(transformed.sql) > maxSqlBytes) {
    throw new Error("transformed_backup_too_large");
  }
  writeFileSync(transformedPath, transformed.sql, { mode: 0o600 });
  importSqlite(sourceDatabasePath, sourceSql, {
    maxBytes: maxSqlBytes,
  });
  const aggregate = collectDatabaseEvidence(sourceDatabasePath);
  if (
    aggregate.integrity !== "ok" ||
    aggregate.foreignKeyViolations !== 0
  ) {
    throw new Error("source_backup_integrity_failed");
  }
  return {
    aggregate,
    afterBackups,
    ownedBackup: nextOwnedBackup,
    remoteObjectKey,
    sourceSql,
    transformed,
  };
}

/** @param {string} outputPath */
async function runAutomation(outputPath) {
  const { runId, runAttempt } = assertAutomationContext();
  const scratchName = buildScratchDatabaseName(runId, runAttempt);
  const maxSqlBytes = resolveMaxSqlBytes();
  const root = mkdtempSync(
    join(tmpdir(), `0509-remote-restore-${runId}-${runAttempt}-`),
  );
  const backupDirectory = resolveBackupLocalDirectory();
  const sourcePath = join(root, "source.sql");
  const transformedPath = join(root, "restore-d1.sql");
  const sourceDatabasePath = join(root, "source.sqlite");
  const scratchExportPath = join(root, "scratch-export.sql");
  const roundTripSqlPath = join(root, "scratch-roundtrip-d1.sql");
  const roundTripDatabasePath = join(root, "scratch-roundtrip.sqlite");
  const scratchConfigPath = join(root, "wrangler-scratch.json");
  const backupManifestPath = join(root, "backup-local-manifest.json");

  let primaryError = null;
  /** @type {{ freshBackupPath: string | null }} */
  const backupState = { freshBackupPath: null };
  try {
    const candidateOutput = await runCaptured(
      "node",
      ["scripts/customer-readiness-candidate.mjs", "--base", "HEAD"],
      { quiet: true },
    );
    const candidate = parseWranglerJson(candidateOutput.stdout);
    if (candidate?.ok !== true || candidate?.status?.hasChanges !== false) {
      throw new Error("remote_restore_candidate_not_clean");
    }

    const runFreshBackup = () =>
      runCaptured("npm", ["run", "backup:d1:r2"], {
        timeoutMs: LONG_COMMAND_TIMEOUT_MS,
        env: { D1_BACKUP_LOCAL_MANIFEST: backupManifestPath },
      });
    const runFreshR2Get = (/** @type {string} */ remoteObjectKey) =>
      runCaptured(
        "npx",
        buildR2GetArgs(BACKUP_BUCKET_NAME, remoteObjectKey, sourcePath),
        { timeoutMs: LONG_COMMAND_TIMEOUT_MS },
      );

    let backup = await importFreshBackup({
      knownBackupFiles: listBackupFiles(backupDirectory),
      backupState,
      sourceDatabasePath,
      sourcePath,
      transformedPath,
      backupManifestPath,
      backupDirectory,
      maxSqlBytes,
      runBackup: runFreshBackup,
      runR2Get: runFreshR2Get,
    });
    const migrations = readdirSync(resolve("migrations"))
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort();
    const ledgerPlan = planSourceBackupLedgerReconciliation(
      backup.aggregate.migrationLedger,
      migrations,
    );
    if (ledgerPlan.action === "reject") {
      rethrowWithMigrationLedgerDiagnostics(
        new Error(ledgerPlan.reason),
        backup.aggregate.migrationLedger,
        migrations,
      );
    }
    if (ledgerPlan.action === "apply_forward_suffix") {
      await applyForwardMigrationSuffix(ledgerPlan.migrations);
      backup = await importFreshBackup({
        knownBackupFiles: backup.afterBackups,
        backupState,
        sourceDatabasePath,
        sourcePath,
        transformedPath,
        backupManifestPath,
        backupDirectory,
        maxSqlBytes,
        runBackup: runFreshBackup,
        runR2Get: runFreshR2Get,
      });
    }
    const {
      aggregate: sourceAggregate,
      ownedBackup,
      remoteObjectKey,
      sourceSql,
      transformed,
    } = backup;
    try {
      assertMigrationLedgerMatchesRepository(
        sourceAggregate.migrationLedger,
        migrations,
      );
    } catch (error) {
      rethrowWithMigrationLedgerDiagnostics(
        error,
        sourceAggregate.migrationLedger,
        migrations,
      );
    }

    const databases = await assertScratchAbsent(scratchName);
    const productionMatches = databases.filter(
      (database) => database.name === PRODUCTION_DATABASE_NAME,
    );
    if (
      productionMatches.length !== 1 ||
      !UUID_PATTERN.test(productionMatches[0].uuid)
    ) {
      throw new Error("production_database_identity_ambiguous");
    }
    const productionDatabase = productionMatches[0];
    assertConfiguredProductionDatabase(
      candidate?.wrangler?.worktreeD1Database,
      productionDatabase,
    );

    const scratchLifecycle = await withScratchCleanup({
      create: async () => {
        const create = await runCaptured("npx", [
          "wrangler",
          "d1",
          "create",
          scratchName,
        ]);
        const reportedScratchUuid = parseCreatedDatabaseUuid(
          `${create.stdout}\n${create.stderr}`,
        );
        const createdMatches = (await listD1Databases()).filter(
          (database) => database.name === scratchName,
        );
        if (
          createdMatches.length !== 1 ||
          !UUID_PATTERN.test(createdMatches[0].uuid) ||
          createdMatches[0].uuid !== reportedScratchUuid
        ) {
          throw new Error("scratch_database_identity_mismatch");
        }
        const scratchUuid = createdMatches[0].uuid;
        writePrivateJson(scratchConfigPath, {
          name: "0509-remote-restore-evidence",
          compatibility_date: "2026-03-29",
          d1_databases: [
            {
              binding: SCRATCH_BINDING,
              database_name: scratchName,
              database_id: scratchUuid,
            },
          ],
        });
        return scratchUuid;
      },
      use: async () => {
        const imported = await runCaptured(
          "npx",
          [
            "wrangler",
            "d1",
            "execute",
            SCRATCH_BINDING,
            "--remote",
            "--file",
            transformedPath,
            "--yes",
            "--json",
            "--config",
            scratchConfigPath,
          ],
          { timeoutMs: LONG_COMMAND_TIMEOUT_MS },
        );
        const databaseBookmark = extractBookmark(
          parseWranglerJson(imported.stdout),
        );

        const representative = await runCaptured(
          "npx",
          [
            "wrangler",
            "d1",
            "execute",
            SCRATCH_BINDING,
            "--remote",
            "--command",
            `SELECT
             (SELECT COUNT(*) FROM d1_migrations) AS migration_count,
             (SELECT COALESCE(
                (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1),
                ''
              )) AS latest_migration,
             (SELECT COUNT(*) FROM user_plan) AS plan_row_count,
             (SELECT COUNT(*) FROM user_plan
               WHERE dodo_payment_id IS NOT NULL
                  OR dodo_subscription_id IS NOT NULL
                  OR dodo_customer_id IS NOT NULL) AS linked_plan_row_count`,
            "--json",
            "--config",
            scratchConfigPath,
          ],
          { quiet: true },
        );
        const representativePayload = parseWranglerJson(representative.stdout);
        const representativeRow = Array.isArray(representativePayload)
          ? representativePayload[0]?.results?.[0]
          : representativePayload?.results?.[0];
        if (
          Number(representativeRow?.migration_count) !==
            sourceAggregate.migrationLedger.length ||
          String(representativeRow?.latest_migration) !==
            sourceAggregate.migrationLedger.at(-1)?.name ||
          Number(representativeRow?.plan_row_count) !==
            sourceAggregate.planRowCount ||
          Number(representativeRow?.linked_plan_row_count) !==
            sourceAggregate.dodoLinkedPlanRowCount
        ) {
          throw new Error(
            "scratch_restore_representative_aggregate_mismatch",
          );
        }

        await runCaptured(
          "npx",
          [
            "wrangler",
            "d1",
            "export",
            SCRATCH_BINDING,
            "--remote",
            "--output",
            scratchExportPath,
            "--skip-confirmation",
            "--config",
            scratchConfigPath,
          ],
          { timeoutMs: LONG_COMMAND_TIMEOUT_MS },
        );
        const scratchExportSql = readSqlFileWithinLimit(
          scratchExportPath,
          maxSqlBytes,
          "scratch_export_invalid",
        );
        const roundTrip = transformD1RestoreSql(scratchExportSql, {
          maxBytes: DEFAULT_MAX_STATEMENT_BYTES,
        });
        if (Buffer.byteLength(roundTrip.sql) > maxSqlBytes) {
          throw new Error("transformed_scratch_export_too_large");
        }
        writeFileSync(roundTripSqlPath, roundTrip.sql, { mode: 0o600 });
        importSqlite(roundTripDatabasePath, roundTrip.sql, {
          maxBytes: maxSqlBytes,
        });
        const roundTripAggregate = collectDatabaseEvidence(
          roundTripDatabasePath,
        );
        assertRestoreRoundTrip(sourceAggregate, roundTripAggregate);
        return databaseBookmark;
      },
      remove: () => removeScratchDatabase(scratchName),
    });
    const scratchUuid = scratchLifecycle.created;
    const databaseBookmark = scratchLifecycle.result;
    const scratchRemoved = scratchLifecycle.scratchRemoved;

    const sourceMigrationNames = sourceAggregate.migrationLedger.map(
      (entry) => entry.name,
    );
    const latestMigration = sourceMigrationNames.at(-1);
    const migrationCount = sourceMigrationNames.length;
    if (!latestMigration) throw new Error("latest_migration_missing");
    const evidence = buildRemoteRestoreEvidence({
      candidate,
      aggregate: sourceAggregate,
      sourceDumpSha256: sha256(sourceSql),
      transformedSqlSha256: sha256(transformed.sql),
      productionDatabase,
      scratchDatabase: { name: scratchName, uuid: scratchUuid },
      databaseBookmark,
      latestMigration,
      migrationCount,
      scratchDatabaseRemoved: scratchRemoved,
    });
    const verdict = validateRemoteRestoreEvidence(evidence, {
      candidateFingerprint: candidate.fingerprint,
      wranglerWorktreeSha256: candidate.wrangler.worktreeSha256,
      allowedMigrationStates: allowedProductionMigrationLedgers(
        migrations,
      ).map((ledger) => migrationLedgerState(ledger)),
      migrationBearing: true,
    });
    if (!verdict.ok) {
      throw new Error(`remote_restore_evidence_invalid:${verdict.issues.join(",")}`);
    }
    writePrivateJson(resolve(outputPath), evidence);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        policy: "fresh-exact-24h",
        backupFile: ownedBackup.fileName,
        remoteObjectKey,
        scratchRemoved: true,
        migrationCount,
        latestMigration,
        rowCountDigestSha256: evidence.rowCountDigestSha256,
        migrationLedgerSha256: evidence.migrationLedgerSha256,
        migrationLedgerNamesSha256: evidence.migrationLedgerNamesSha256,
      })}\n`,
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    let preserveOwnershipManifest = false;
    if (!backupState.freshBackupPath && existsSync(backupManifestPath)) {
      try {
        backupState.freshBackupPath = readOwnedBackupManifest(
          backupManifestPath,
          backupDirectory,
        ).localPath;
      } catch (error) {
        cleanupErrors.push(error);
        preserveOwnershipManifest = true;
      }
    }
    if (backupState.freshBackupPath) {
      try {
        removeOwnedLocalBackup(backupState.freshBackupPath);
      } catch (error) {
        cleanupErrors.push(error);
        preserveOwnershipManifest = true;
      }
    }
    if (!preserveOwnershipManifest) {
      try {
        rmSync(root, { recursive: true, force: true });
        if (existsSync(root)) {
          throw new Error("remote_restore_temp_cleanup_incomplete");
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      if (primaryError) {
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          "remote_restore_cleanup_failed_after_restore_failure",
          { cause: primaryError },
        );
      }
      throw new AggregateError(
        cleanupErrors,
        "remote_restore_cleanup_failed",
        { cause: cleanupErrors[0] },
      );
    }
  }
}

/** @param {string} name */
function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outputPath = readArg("--output");
  const cleanupOnly = process.argv.includes("--cleanup-only");
  if (!outputPath && !cleanupOnly) {
    process.stderr.write("remote_restore_output_path_missing\n");
    process.exitCode = 1;
  } else {
    try {
      if (cleanupOnly) {
        const { runId, runAttempt } = assertAutomationContext();
        const scratchName = buildScratchDatabaseName(runId, runAttempt);
        const sweepStale = process.argv.includes("--sweep-stale");
        const cleanupErrors = [];
        /** @type {string[]} */
        let currentRunScratchNames = [];
        /** @type {string[]} */
        let staleNames = [];
        /** @type {string[]} */
        let removed = [];
        /** @type {string[]} */
        let localTempDirectoriesRemoved = [];
        try {
          const databases = await retryCleanupProviderOperation(
            () => listD1Databases(),
          );
          currentRunScratchNames =
            currentRunScratchDatabaseNames(databases, runId);
          staleNames = sweepStale
            ? staleScratchDatabaseNames(databases)
            : [];
          removed = await cleanupScratchDatabaseNames([
            scratchName,
            ...currentRunScratchNames,
            ...staleNames,
          ]);
        } catch (error) {
          cleanupErrors.push(error);
        }
        try {
          localTempDirectoriesRemoved =
            cleanupLocalRestoreTempDirectories({
              runId,
              sweepStale,
            });
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            "remote_restore_independent_cleanup_failed",
            { cause: cleanupErrors[0] },
          );
        }
        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            scratchName,
            scratchRemoved: true,
            currentRunScratchDatabasesRemoved:
              currentRunScratchNames.filter((name) =>
                removed.includes(name),
              ).length,
            staleScratchDatabasesRemoved:
              staleNames.filter((name) => removed.includes(name)).length,
            localTempDirectoriesRemoved:
              localTempDirectoriesRemoved.length,
          })}\n`,
        );
      } else {
        await runAutomation(/** @type {string} */ (outputPath));
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "remote_restore_failed";
      process.stderr.write(`${redactSensitiveOutput(message)}\n`);
      process.exitCode = 1;
    }
  }
}
