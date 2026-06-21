#!/usr/bin/env node
import { existsSync, readdirSync, renameSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const localEnvFilePattern = /^(?:\.dev\.vars(?:\..+)?|\.env(?:\..+)?)$/;

const movedLocalEnvFiles = [];
let exitCode = 0;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: {
      ...process.env,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(" ")} failed`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

try {
  for (const name of readdirSync(root)) {
    if (!localEnvFilePattern.test(name)) {
      continue;
    }

    const source = join(root, name);
    if (!statSync(source).isFile()) {
      continue;
    }

    const held = join(root, `.deploy-hold-${process.pid}-${movedLocalEnvFiles.length}-${name.slice(1)}`);
    renameSync(source, held);
    movedLocalEnvFiles.push({ source, held });
  }

  run("node", ["scripts/check-public-home-current.mjs", "--source-only"]);
  run("node", ["scripts/check-d1-migrations-synced.mjs"]);
  run("npm", ["run", "build"]);
  run("node", ["scripts/check-public-home-current.mjs"]);
  run("wrangler", ["deploy"]);
  run("node", ["scripts/check-live-public-home.mjs"]);
  run("node", ["scripts/check-google-oauth-branding.mjs"]);
} catch (error) {
  exitCode = error && typeof error.exitCode === "number" ? error.exitCode : 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  for (const { source, held } of movedLocalEnvFiles.reverse()) {
    if (existsSync(held)) {
      renameSync(held, source);
    }
  }
}

process.exit(exitCode);
