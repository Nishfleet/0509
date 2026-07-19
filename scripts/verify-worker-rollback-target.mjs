#!/usr/bin/env node
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

const targetPath = requiredPath("--target");
const wranglerOutputPath = requiredPath("--wrangler-output");
const evidence = JSON.parse(readFileSync(targetPath, "utf8"));
const deployedVersionId = readDeployedWorkerVersionId(readFileSync(wranglerOutputPath, "utf8"));
const verdict = validateWorkerRollbackEvidence(evidence, { deployedVersionId });
if (!verdict.ok) throw new Error(verdict.issues.join(","));
const rollback = buildWorkerRollbackCommand(evidence.versionId, deployedVersionId);
process.stdout.write(`${JSON.stringify({
  ok: true,
  priorVersionId: evidence.versionId,
  deployedVersionId,
  rollback,
})}\n`);
