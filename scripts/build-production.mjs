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
      WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS ?? "false",
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

    const held = join(root, `.build-hold-${process.pid}-${movedLocalEnvFiles.length}-${name.slice(1)}`);
    renameSync(source, held);
    movedLocalEnvFiles.push({ source, held });
  }

  run("react-router", ["build"]);

  // Guard the Worker's uncompressed bundle size against Cloudflare's 64 MiB
  // limit. Cloudflare removed the compressed-size cap on 2026-09-04; only the
  // uncompressed 64 MiB limit applies across all plans. This runs
  // `wrangler deploy --dry-run` and fails the build if "Total Upload" exceeds
  // 64 MiB, so an oversize bundle is caught here (CI/preview/deploy) rather
  // than rejected at platform deploy time. See issue #1733 and
  // scripts/check-worker-bundle-size.mjs.
  run("node", ["scripts/check-worker-bundle-size.mjs"]);
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
