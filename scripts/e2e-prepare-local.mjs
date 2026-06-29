#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const commonEnv = {
  ...process.env,
  SAFE_DEPLOY_APPROVED: process.env.SAFE_DEPLOY_APPROVED || "d1",
};

function run(label, command, args) {
  const result = spawnSync(command, args, {
    env: commonEnv,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`${label}: failed`);
    process.exit(result.status ?? 1);
  }
}

run("local D1 migrations", "npx", ["wrangler", "d1", "migrations", "apply", "0509", "--local"]);
run("local E2E fixtures", "npx", [
  "wrangler",
  "d1",
  "execute",
  "0509",
  "--local",
  "--file",
  "e2e/fixtures/e2e-local.sql",
]);

console.log("local E2E D1 fixtures: ready");
