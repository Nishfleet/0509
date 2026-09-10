#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readDeployedWorkerVersionId } from "./deploy-production-plan.mjs";
import {
  buildWorkerRollbackCommand,
  buildWorkerSourceRollbackSteps,
  parseWorkerDeploymentStatus,
  resolveLastGatedReleaseSha,
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

function runStep(step) {
  const stepResult = spawnSync(step.command, step.args, {
    cwd: step.cwd ?? process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (stepResult.error) throw stepResult.error;
  if (stepResult.status !== 0) throw new Error(`worker_rollback_step_failed:${step.id}`);
}

/**
 * Versioned rollback failed — almost always because the captured target aged
 * out of Cloudflare's deployable window before this ran (code 10210; per-PR
 * preview uploads churn that window hourly at fleet merge velocity). Restore
 * the last fully gated release instead: check out its commit in a scratch
 * worktree, install + build + `wrangler deploy` it there, then prove the live
 * deployment moved off the failed version.
 */
async function rollbackViaSourceRedeploy() {
  const override = process.env.WORKER_ROLLBACK_RELEASE_SHA?.trim();
  const sha = override || (await resolveLastGatedReleaseSha());
  if (!sha) throw new Error("worker_rollback_no_gated_release");
  const nameIndex = rollback.args.indexOf("--name");
  const workerName = nameIndex >= 0 ? rollback.args[nameIndex + 1] : undefined;
  const parent = mkdtempSync(join(tmpdir(), "0509-rollback-release-"));
  const worktreeDir = join(parent, "src");
  try {
    // The post-redeploy proof must compare against a KNOWN-bad version: the
    // failed deploy's id when the wrangler output carried it, else whatever is
    // live right now. With neither, a no-op or wrong-worker redeploy would
    // still read as success — refuse instead.
    let liveBefore = null;
    const preStatus = spawnSync(
      process.env.WRANGLER_BIN || "wrangler",
      ["deployments", "status", "--json"],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    if (!preStatus.error && preStatus.status === 0) {
      try {
        liveBefore = parseWorkerDeploymentStatus(preStatus.stdout).versionId;
      } catch {
        // An unparseable status is treated as unknown, not as proof.
      }
    }
    const knownBadVersionId = deployedVersionId ?? liveBefore;
    if (!knownBadVersionId) {
      throw new Error("worker_rollback_live_version_unknown");
    }
    const wranglerBin =
      process.env.WRANGLER_BIN || join(worktreeDir, "node_modules", ".bin", "wrangler");
    for (const step of buildWorkerSourceRollbackSteps({ sha, worktreeDir, wranglerBin, workerName })) {
      runStep(step);
    }
    const status = spawnSync(wranglerBin, ["deployments", "status", "--json"], {
      cwd: worktreeDir,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (status.error) throw status.error;
    if (status.status !== 0) throw new Error("worker_deployment_status_failed");
    const live = parseWorkerDeploymentStatus(status.stdout);
    if (
      live.versionId === knownBadVersionId ||
      (liveBefore && live.versionId === liveBefore)
    ) {
      throw new Error("worker_rollback_version_unchanged");
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        rollback: "source_redeploy",
        sha,
        liveVersionId: live.versionId,
      })}\n`,
    );
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", worktreeDir], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    rmSync(parent, { recursive: true, force: true });
  }
}

if (result.status !== 0) {
  process.stderr.write(
    "versioned rollback failed — redeploying the last gated release commit instead\n",
  );
  try {
    await rollbackViaSourceRedeploy();
  } catch (fallbackError) {
    throw new Error("worker_rollback_failed", { cause: fallbackError });
  }
}
