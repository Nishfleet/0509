#!/usr/bin/env node
// Fails when the remote production D1 database has unapplied migrations.
// Schema changes must ship as numbered files in migrations/ and be applied
// with `wrangler d1 migrations apply 0509 --remote` — never via direct
// `d1 execute` DDL. This guard keeps the migration ledger and production
// reality from drifting apart (see the 0019_slack_delivery incident,
// 2026-06-11).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATABASE_NAME = "0509";

const result = spawnSync("wrangler", ["d1", "migrations", "list", DATABASE_NAME, "--remote"], {
  cwd: root,
  env: process.env,
  encoding: "utf8",
});

if (result.error) {
  console.error(`d1 migration sync check could not run: ${result.error.message}`);
  process.exit(1);
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

if (result.status !== 0) {
  console.error(output.trim());
  console.error("d1 migration sync check failed: wrangler exited non-zero.");
  process.exit(1);
}

if (!/No migrations to apply/i.test(output)) {
  console.error(output.trim());
  console.error(
    [
      "d1 migration sync check failed: remote database is behind migrations/.",
      `Run \`npx wrangler d1 migrations apply ${DATABASE_NAME} --remote\` first, then deploy.`,
    ].join("\n"),
  );
  process.exit(1);
}

console.log("d1 migration sync check passed: remote database matches migrations/.");
