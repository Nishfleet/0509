// Weekly off-site backup: export remote D1 to a local SQL file, upload it to
// the existing R2 bucket under backups/, and prune local copies (keep 8).
// Run via `npm run backup:d1:r2`. It can be scheduled by launchd outside the
// repo, but this script does not prove that scheduling is currently active.
// R2 copies are never pruned by this script.
import { mkdir, readdir, unlink, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  assertBackupAutomationApproval,
  assertManualBackupApproval,
  buildD1ExportArgs,
  buildBackupObjectKey,
  buildR2PutArgs,
} from "./d1-backup-command-args.mjs";
import { runCommandRedacted } from "./safe-command-output.mjs";

const databaseName = process.env.D1_DATABASE_NAME || "0509";
const bucketName = process.env.R2_BACKUP_BUCKET || "0509-landing-page-artifacts";
const localDir = resolve("backups/d1");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const fileName = `${databaseName}-${stamp}.sql`;
const localPath = join(localDir, fileName);
const remoteKey = buildBackupObjectKey(databaseName, stamp);
const KEEP_LOCAL = 8;

const automationApproved = assertBackupAutomationApproval({ databaseName, bucketName });
const manualApproved = assertManualBackupApproval({ databaseName, bucketName, automationApproved });
const skipD1ExportConfirmation = automationApproved || manualApproved;

await mkdir(localDir, { recursive: true });

console.log(`Exporting D1 '${databaseName}' to ${localPath}`);
await runCommandRedacted("npx", buildD1ExportArgs(databaseName, localPath, { skipConfirmation: skipD1ExportConfirmation }));

const exported = await stat(localPath);
if (exported.size === 0) {
  throw new Error("D1 export produced an empty file; not uploading.");
}

console.log(`Uploading to r2://${bucketName}/${remoteKey} (${Math.round(exported.size / 1024)} KiB)`);
await runCommandRedacted("npx", buildR2PutArgs(bucketName, remoteKey, localPath));

const entries = (await readdir(localDir))
  .filter((name) => name.startsWith(`${databaseName}-`) && name.endsWith(".sql"))
  .sort()
  .reverse();
for (const stale of entries.slice(KEEP_LOCAL)) {
  await unlink(join(localDir, stale));
  console.log(`Pruned local backup ${stale}`);
}

console.log("Backup complete.");
