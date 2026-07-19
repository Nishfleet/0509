#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRemoteRestoreEvidence } from "./deploy-production-plan.mjs";

/** @param {string} name */
function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function migrationBearingOverride() {
  const value =
    process.env.D1_REMOTE_RESTORE_MIGRATION_BEARING?.trim().toLowerCase();
  if (!value) return null;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("remote_restore_migration_classification_invalid");
}

/** @param {unknown} diffOutput */
export function hasMigrationChanges(diffOutput) {
  return String(diffOutput)
    .split(/\r?\n/u)
    .some((name) => /^migrations\/\d{4}_.+\.sql$/u.test(name.trim()));
}

async function isMigrationBearingDeploy() {
  const override = migrationBearingOverride();
  if (override !== null) return override;

  const token = process.env.GITHUB_TOKEN?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const currentRunId = Number(process.env.GITHUB_RUN_ID);
  if (!token || !repository || !Number.isInteger(currentRunId)) {
    throw new Error("remote_restore_migration_classification_unavailable");
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/deploy-production.yml/runs?branch=main&status=success&per_page=20`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
      },
    },
  );
  if (!response.ok)
    throw new Error("remote_restore_last_successful_deploy_unavailable");
  const payload =
    /** @type {{ workflow_runs?: Array<{ id?: number, conclusion?: string, head_sha?: string }> }} */ (
      await response.json()
    );
  const previous = Array.isArray(payload?.workflow_runs)
    ? payload.workflow_runs.find(
        (run) =>
          Number(run?.id) !== currentRunId &&
          run?.conclusion === "success" &&
          /^[a-f0-9]{40}$/u.test(run?.head_sha ?? ""),
      )
    : null;
  if (!previous)
    throw new Error("remote_restore_last_successful_deploy_missing");

  const changed = execFileSync(
    "git",
    ["diff", "--name-only", `${previous.head_sha}..HEAD`, "--", "migrations"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return hasMigrationChanges(changed);
}

async function main() {
  const manifestPath = readArg("--manifest");
  const evidencePath = readArg("--remote-evidence");
  if (!manifestPath || !evidencePath)
    throw new Error("remote_restore_evidence_arguments_missing");
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  const evidence = JSON.parse(readFileSync(resolve(evidencePath), "utf8"));
  const migrations = readdirSync(resolve("migrations"))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  const migrationBearing = await isMigrationBearingDeploy();
  const verdict = validateRemoteRestoreEvidence(evidence, {
    candidateFingerprint: manifest.candidateFingerprint,
    wranglerWorktreeSha256:
      manifest.postflight?.launchConfig?.wranglerWorktreeSha256,
    latestMigration: migrations.at(-1),
    migrationCount: migrations.length,
    migrationBearing,
  });
  process.stdout.write(
    `${JSON.stringify({ ...verdict, policy: migrationBearing ? "fresh-exact-24h" : "verified-ledger-7d" })}\n`,
  );
  if (!verdict.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        issues: [
          error instanceof Error
            ? error.message
            : "remote_restore_evidence_unavailable",
        ],
      })}\n`,
    );
    process.exitCode = 1;
  }
}
