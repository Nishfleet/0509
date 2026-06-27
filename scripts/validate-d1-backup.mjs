import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const requiredSupportFiles = [
  "scripts/d1-backup-to-r2.mjs",
  "scripts/d1-backup.mjs",
  "wrangler.jsonc",
];
const migrationsDir = resolve("migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error("No D1 migration files found.");
}

const requiredFiles = [
  ...requiredSupportFiles,
  ...migrationFiles.map((fileName) => join("migrations", fileName)),
];

for (const relativePath of requiredFiles) {
  const absolutePath = resolve(relativePath);
  readFileSync(absolutePath, "utf8");
}

const wrangler = readFileSync(resolve("wrangler.jsonc"), "utf8");
if (!wrangler.includes('"d1_databases"') || !wrangler.includes('"database_name": "0509"')) {
  throw new Error("wrangler.jsonc is missing the 0509 D1 database binding.");
}

console.log(
  JSON.stringify({
    ok: true,
    mode: "dry-run",
    checkedFiles: requiredFiles,
    latestMigration: migrationFiles.at(-1),
    message: "Backup scripts and D1 binding are present. Remote export/upload was not executed.",
  }),
);
