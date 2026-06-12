// Weekly off-site backup: export remote D1 to a local SQL file, upload it to
// the existing R2 bucket under backups/, and prune local copies (keep 8).
// Run via `npm run backup:d1:r2` — scheduled by launchd on Nish's Mac
// (com.nish.0509-d1-backup). R2 copies are never pruned by this script.
import { mkdir, readdir, unlink, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";

const databaseName = process.env.D1_DATABASE_NAME || "0509";
const bucketName = process.env.R2_BACKUP_BUCKET || "0509-landing-page-artifacts";
const localDir = resolve("backups/d1");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const fileName = `${databaseName}-${stamp}.sql`;
const localPath = join(localDir, fileName);
const remoteKey = `backups/d1/${fileName}`;
const KEEP_LOCAL = 8;

function runCommand(command, args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} stopped by signal ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}`));
      else resolveExit();
    });
  });
}

await mkdir(localDir, { recursive: true });

console.log(`Exporting D1 '${databaseName}' to ${localPath}`);
await runCommand("npx", ["wrangler", "d1", "export", databaseName, "--remote", "--output", localPath]);

const exported = await stat(localPath);
if (exported.size === 0) {
  throw new Error("D1 export produced an empty file; not uploading.");
}

console.log(`Uploading to r2://${bucketName}/${remoteKey} (${Math.round(exported.size / 1024)} KiB)`);
await runCommand("npx", [
  "wrangler",
  "r2",
  "object",
  "put",
  `${bucketName}/${remoteKey}`,
  "--file",
  localPath,
  "--remote",
]);

const entries = (await readdir(localDir))
  .filter((name) => name.startsWith(`${databaseName}-`) && name.endsWith(".sql"))
  .sort()
  .reverse();
for (const stale of entries.slice(KEEP_LOCAL)) {
  await unlink(join(localDir, stale));
  console.log(`Pruned local backup ${stale}`);
}

console.log("Backup complete.");
