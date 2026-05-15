#!/usr/bin/env node
import { existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const devVarsPath = join(root, ".dev.vars");
const heldDevVarsPath = join(root, `.dev.vars.deploy-hold-${process.pid}`);

let movedDevVars = false;
let exitCode = 0;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
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
  if (existsSync(devVarsPath)) {
    renameSync(devVarsPath, heldDevVarsPath);
    movedDevVars = true;
  }

  run("npm", ["run", "build"]);
  run("wrangler", ["deploy"]);
} catch (error) {
  exitCode = error && typeof error.exitCode === "number" ? error.exitCode : 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  if (movedDevVars && existsSync(heldDevVarsPath)) {
    renameSync(heldDevVarsPath, devVarsPath);
  }
}

process.exit(exitCode);
