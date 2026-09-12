#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import {
  buildWorkerRollbackCommand,
  chooseExistingRollbackTarget,
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
// 2026-09-12: verify the recorded target still exists before asking Cloudflare
// to roll back to it; otherwise pick the newest real deploy. Fail loud if none.
const listed = spawnSync(process.env.WRANGLER_BIN || "wrangler", ["versions", "list", "--json"], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
});
let versionsList = [];
if (listed.status === 0) {
  try {
    versionsList = JSON.parse(listed.stdout);
  } catch {
    versionsList = [];
  }
}
const chosen = chooseExistingRollbackTarget(versionsList, evidence.versionId, deployedVersionId);
console.log(JSON.stringify({ rollbackTarget: chosen.versionId, reason: chosen.reason, recorded: evidence.versionId }));
const rollback = buildWorkerRollbackCommand(chosen.versionId, deployedVersionId);
const result = spawnSync(process.env.WRANGLER_BIN || rollback.command, rollback.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("worker_rollback_failed");
