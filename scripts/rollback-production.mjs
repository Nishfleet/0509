#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import {
  buildWorkerRollbackCommand,
  validateWorkerRollbackEvidence,
} from "./worker-rollback-target.mjs";

function requiredPath(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`${name.slice(2)}_required`);
  return resolve(process.cwd(), process.argv[index + 1]);
}

const evidence = JSON.parse(readFileSync(requiredPath("--target"), "utf8"));
const deployedVersionId = readDeployedWorkerVersionId(
  readFileSync(requiredPath("--wrangler-output"), "utf8"),
);
const verdict = validateWorkerRollbackEvidence(evidence, { deployedVersionId });
if (!verdict.ok) throw new Error(verdict.issues.join(","));
const rollback = buildWorkerRollbackCommand(evidence.versionId, deployedVersionId);
const result = spawnSync(rollback.command, rollback.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("worker_rollback_failed");
