#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import {
  buildWorkerRollbackCommand,
  chooseExistingRollbackTarget,
  readLastGreenLedgerVersionId,
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
// Last GREEN version from the on-main deploy ledger (issue #3190): the
// pre-deploy 100% evidence target is NOT guaranteed to still exist when the
// rollback runs — Cloudflare answered `Version not found: aa2fefb2` for a
// version that was the 100% deployment 30 seconds earlier (run 34679399412).
// The ledger's newest version_id names a version that provably ran green, so
// it wins; the captured evidence stays the fallback when the ledger yields
// nothing or merely repeats the freshly deployed version.
let rollbackVersionId = evidence.versionId;
const deployLedgerIndex = process.argv.indexOf("--deploy-ledger");
if (deployLedgerIndex >= 0 && deployLedgerIndex + 1 < process.argv.length) {
  try {
    const ledgerVersionId = readLastGreenLedgerVersionId(
      readFileSync(resolve(process.cwd(), process.argv[deployLedgerIndex + 1]), "utf8"),
    );
    if (
      ledgerVersionId &&
      (deployedVersionId === null || deployedVersionId === undefined || ledgerVersionId !== deployedVersionId)
    ) {
      rollbackVersionId = ledgerVersionId;
    }
  } catch {
    // A missing/unreadable ledger keeps the captured evidence target — the
    // rollback must not silently skip because a passive evidence file was
    // unreadable.
  }
}
// 2026-09-12 (#3239): when Cloudflare's versions list answers, verify the
// preferred target still exists before asking Cloudflare to roll back to it;
// otherwise pick the newest real deploy and fail loud if none. When the
// read-only probe itself fails or answers nothing, the rescue must still
// proceed to the ledger-resolved (or captured) target — #3190's incident
// (run 34679399412) left the fresh, failing Worker live, and an
// inconclusive probe must not repeat that; a truly missing target still
// fails loud at the rollback spawn itself.
const listed = spawnSync(process.env.WRANGLER_BIN || "wrangler", ["versions", "list", "--json"], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
});
let versionsList = null;
if (listed.status === 0) {
  try {
    const parsed = JSON.parse(listed.stdout);
    if (Array.isArray(parsed)) versionsList = parsed;
  } catch {
    // inconclusive — see above
  }
}
const chosen = versionsList
  ? chooseExistingRollbackTarget(versionsList, rollbackVersionId, deployedVersionId)
  : { versionId: rollbackVersionId, reason: "versions_list_unavailable" };
console.log(JSON.stringify({ rollbackTarget: chosen.versionId, reason: chosen.reason, recorded: evidence.versionId }));
const rollback = buildWorkerRollbackCommand(chosen.versionId, deployedVersionId);
const result = spawnSync(process.env.WRANGLER_BIN || rollback.command, rollback.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("worker_rollback_failed");
