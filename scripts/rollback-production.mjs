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
const verdict = validateWorkerRollbackEvidence(evidence);
if (!verdict.ok) throw new Error(verdict.issues.join(","));

let deployedVersionId;
const wranglerOutputIndex = process.argv.indexOf("--wrangler-output");
if (wranglerOutputIndex >= 0 && wranglerOutputIndex + 1 < process.argv.length) {
  try {
    deployedVersionId = readDeployedWorkerVersionId(
      readFileSync(resolve(process.cwd(), process.argv[wranglerOutputIndex + 1]), "utf8"),
    );
  } catch {
    // A deploy can publish successfully and then exit before its machine output
    // is complete. Recovery must still use the exact predeploy version captured
    // for this release attempt rather than leaving the ambiguous release live.
  }
}
const rollback = buildWorkerRollbackCommand(evidence.versionId, deployedVersionId);
const result = spawnSync(process.env.WRANGLER_BIN || rollback.command, rollback.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("worker_rollback_failed");
