// Weekly off-site backup: export remote D1 to a local SQL file, upload it to
// the existing R2 bucket under backups/, and prune local copies (keep 8).
// Run via `npm run backup:d1:r2`. It can be scheduled by launchd outside the
// repo, but this script does not prove that scheduling is currently active.
// R2 copies are never pruned by this script.
//
// 0509#3576: this is also the cheap half of the deploy gate's backup proof.
// The export imports nothing and creates no scratch database, so it is the only
// part of the old drill that has to be run often. When the caller sets
// `D1_BACKUP_EXPORT_RECORD`, the script writes the R2 object key it just
// uploaded plus its byte size and digest as the export record the deploy gate
// reads (`validateBackupExport` in deploy-production-plan.mjs). The record is
// written only after the upload returns, so it can never name an object that
// is not in R2.
import { createHash } from "node:crypto";
import { readdir, readFile, unlink, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  assertBackupAutomationApproval,
  assertManualBackupApproval,
  buildD1ExportArgs,
  buildBackupObjectKey,
  buildR2PutArgs,
  resolveBackupLocalDirectory,
} from "./d1-backup-command-args.mjs";
import {
  assertAutomationBackupLocalDirectory,
  isRetryableD1ExportBusyError,
  prepareBackupLocalDirectory,
  secureBackupLocalFile,
} from "./d1-backup-local-storage.mjs";
import { runCommandRedacted } from "./safe-command-output.mjs";

const databaseName = process.env.D1_DATABASE_NAME || "0509";
const bucketName = process.env.R2_BACKUP_BUCKET || "0509-landing-page-artifacts";
const localDir = resolveBackupLocalDirectory();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const fileName = `${databaseName}-${stamp}.sql`;
const localPath = join(localDir, fileName);
const remoteKey = buildBackupObjectKey(databaseName, stamp);
const localManifestPath =
  process.env.D1_BACKUP_LOCAL_MANIFEST?.trim() || null;
// The deploy gate's export record (0509#3576). Distinct from the local manifest
// above: that one tracks the private plaintext dump for cleanup, this one is
// the public-safe freshness record (key, size, digest) the gate reads.
const exportRecordPath =
  process.env.D1_BACKUP_EXPORT_RECORD?.trim() || null;
const KEEP_LOCAL = 8;
const PROVIDER_ATTEMPTS = 4;
const D1_EXPORT_ATTEMPTS = 16;
const PROVIDER_RETRY_BASE_DELAY_MS = 30_000;
const D1_EXPORT_RETRY_DELAY_CAP_MS = 300_000;

/** @param {number} milliseconds */
function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

/**
 * Retry one provider operation without changing its local path or R2 key.
 * @param {string} label
 * @param {(attempt: number) => Promise<unknown>} operation
 * @param {{
 *   attempts?: number,
 *   delayCapMs?: number,
 *   shouldRetry?: (error: unknown) => boolean,
 * }} [options]
 */
async function runProviderOperationWithRetry(
  label,
  operation,
  {
    attempts = PROVIDER_ATTEMPTS,
    delayCapMs = Number.POSITIVE_INFINITY,
    shouldRetry = () => true,
  } = {},
) {
  /** @type {unknown[]} */
  const errors = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      errors.push(error);
      if (!shouldRetry(error)) throw error;
      if (attempt < attempts) {
        console.warn(`${label} failed; retrying attempt ${attempt + 1}.`);
        await delay(
          Math.min(attempt * PROVIDER_RETRY_BASE_DELAY_MS, delayCapMs),
        );
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(
    errors,
    `${label} failed after ${attempts} attempts.`,
    { cause: errors[0] },
  );
}

async function removePartialLocalExport() {
  await unlink(localPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

const automationApproved = assertBackupAutomationApproval({ databaseName, bucketName });
const manualApproved = assertManualBackupApproval({ databaseName, bucketName, automationApproved });
const skipD1ExportConfirmation = automationApproved || manualApproved;

if (automationApproved) {
  assertAutomationBackupLocalDirectory(localDir);
}
await prepareBackupLocalDirectory(localDir);
if (localManifestPath) {
  await writeFile(
    resolve(localManifestPath),
    `${JSON.stringify({
      schemaVersion: 1,
      localPath,
      remoteKey,
    })}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
}

console.log(`Exporting D1 '${databaseName}' to ${localPath}`);
await runProviderOperationWithRetry(
  "D1 export",
  async () => {
    await removePartialLocalExport();
    try {
      await runCommandRedacted(
        "npx",
        buildD1ExportArgs(databaseName, localPath, {
          skipConfirmation: skipD1ExportConfirmation,
        }),
      );
    } catch (exportError) {
      try {
        await removePartialLocalExport();
      } catch (cleanupError) {
        throw new AggregateError(
          [exportError, cleanupError],
          "D1 export failed and its partial local file could not be removed.",
          { cause: exportError },
        );
      }
      throw exportError;
    }
  },
  {
    attempts: D1_EXPORT_ATTEMPTS,
    delayCapMs: D1_EXPORT_RETRY_DELAY_CAP_MS,
    shouldRetry: isRetryableD1ExportBusyError,
  },
);

await secureBackupLocalFile(localPath);
const exported = await stat(localPath);
if (exported.size === 0) {
  throw new Error("D1 export produced an empty file; not uploading.");
}

console.log(`Uploading to r2://${bucketName}/${remoteKey} (${Math.round(exported.size / 1024)} KiB)`);
try {
  await runProviderOperationWithRetry("R2 backup upload", async () => {
    await runCommandRedacted(
      "npx",
      buildR2PutArgs(bucketName, remoteKey, localPath),
    );
  });
} catch (uploadError) {
  if (!localManifestPath && !automationApproved) throw uploadError;
  try {
    await removePartialLocalExport();
  } catch (cleanupError) {
    throw new AggregateError(
      [uploadError, cleanupError],
      "R2 upload failed and its unverified local export could not be removed.",
      { cause: uploadError },
    );
  }
  throw uploadError;
}

// The object is in R2 now; record what the gate must verify. `wx` refuses to
// overwrite a record from an earlier attempt, so a re-run cannot leave a stale
// timestamp looking fresh.
if (exportRecordPath) {
  const digest = createHash("sha256")
    .update(await readFile(localPath))
    .digest("hex");
  await writeFile(
    resolve(exportRecordPath),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      bucket: bucketName,
      remoteKey,
      objectBytes: exported.size,
      sha256: digest,
    })}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
}

if (automationApproved && !localManifestPath) {
  await removePartialLocalExport();
} else if (!localManifestPath) {
  const entries = (await readdir(localDir))
    .filter(
      (name) =>
        name.startsWith(`${databaseName}-`) && name.endsWith(".sql"),
    )
    .sort()
    .reverse();
  for (const stale of entries.slice(KEEP_LOCAL)) {
    await unlink(join(localDir, stale));
    console.log(`Pruned local backup ${stale}`);
  }
}

console.log("Backup complete.");
