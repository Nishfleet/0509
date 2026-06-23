import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredFiles = [
  "scripts/d1-backup-to-r2.mjs",
  "scripts/d1-backup.mjs",
  "wrangler.jsonc",
  "migrations/0045_dodo_plan_lookup_indexes.sql",
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
    message: "Backup scripts and D1 binding are present. Remote export/upload was not executed.",
  }),
);
