#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRemoteRestoreEvidence } from "./deploy-production-plan.mjs";
import {
  allowedProductionMigrationLedgers,
  migrationLedgerState,
} from "./d1-migration-sync-check.lib.mjs";

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

/** @param {Record<string, string | undefined>} env */
export function minimumValidityMs(env = process.env) {
  const value =
    env.D1_REMOTE_RESTORE_EVIDENCE_MIN_VALIDITY_MS?.trim() ?? "";
  if (!value) return 0;
  if (!/^[0-9]{1,8}$/u.test(value)) {
    throw new Error("remote_restore_minimum_validity_invalid");
  }
  const milliseconds = Number(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    milliseconds > 24 * 60 * 60 * 1000
  ) {
    throw new Error("remote_restore_minimum_validity_invalid");
  }
  return milliseconds;
}

/** @param {unknown} diffOutput */
export function hasMigrationChanges(diffOutput) {
  return String(diffOutput)
    .split(/\r?\n/u)
    .some((name) => /^migrations\/\d{4}_.+\.sql$/u.test(name.trim()));
}

/** @param {unknown} diffOutput */
export function hasAppliedMigrationMutation(diffOutput) {
  return String(diffOutput)
    .split(/\r?\n/u)
    .some((line) => {
      const [status = "", ...paths] = line.split("\t");
      return (
        status !== "A" &&
        paths.some((name) =>
          /^migrations\/\d{4}_.+\.sql$/u.test(name.trim()),
        )
      );
    });
}

/** @param {unknown[]} commitDiffs */
export function hasMigrationMutationAcrossCommits(commitDiffs) {
  if (!Array.isArray(commitDiffs)) {
    throw new Error("remote_restore_migration_history_invalid");
  }
  return commitDiffs.some((diff) => hasAppliedMigrationMutation(diff));
}

/** @param {string} previousHead */
export function firstParentMigrationDiffs(previousHead) {
  const head = execFileSync(
    "git",
    ["rev-parse", "--verify", "HEAD^{commit}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (!/^[a-f0-9]{40}$/u.test(head)) {
    throw new Error("remote_restore_migration_history_invalid");
  }
  if (head === previousHead) return [];
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", previousHead, "HEAD"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const commits = execFileSync(
    "git",
    ["rev-list", "--first-parent", "--reverse", `${previousHead}..${head}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  if (
    commits.length === 0 ||
    commits.length > 1_000 ||
    commits.some((commit) => !/^[a-f0-9]{40}$/u.test(commit))
  ) {
    throw new Error("remote_restore_migration_history_invalid");
  }
  const firstParent = execFileSync(
    "git",
    ["rev-parse", `${commits[0]}^1`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (firstParent !== previousHead) {
    throw new Error("remote_restore_migration_history_invalid");
  }
  return commits.map((commit) =>
    execFileSync(
      "git",
      [
        "diff",
        "--name-status",
        "--no-renames",
        `${commit}^1`,
        commit,
        "--",
        "migrations",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
}

/** @param {unknown} diffOutput */
function changedPathsFromNameStatus(diffOutput) {
  return String(diffOutput)
    .split(/\r?\n/u)
    .flatMap((line) => line.split("\t").slice(1))
    .filter(Boolean)
    .join("\n");
}

const RESTORE_CRITICAL_PATH_PATTERN =
  /^(?:wrangler\.jsonc|\.node-version|package(?:-lock)?\.json|\.github\/workflows\/(?:deploy-production|d1-backup-r2|d1-remote-restore-evidence)\.yml|scripts\/(?:customer-readiness-candidate|deploy-production-plan|safe-command-output|validate-d1-backup|build-remote-restore-candidate-manifest|find-recent-remote-restore-artifact|verify-remote-restore-evidence|d1-(?:backup|migration-sync|remote-restore|restore)[^/]*)\.mjs)$/u;

/** @param {unknown} diffOutput */
export function hasRestoreCriticalChanges(diffOutput) {
  return String(diffOutput)
    .split(/\r?\n/u)
    .some((name) => RESTORE_CRITICAL_PATH_PATTERN.test(name.trim()));
}

async function restoreEvidenceClassification() {
  const override = migrationBearingOverride();
  if (override !== null) {
    return {
      migrationBearing: override,
      restoreCritical: override,
    };
  }

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
  const previousHead = previous.head_sha;
  if (
    typeof previousHead !== "string" ||
    !/^[a-f0-9]{40}$/u.test(previousHead)
  ) {
    throw new Error("remote_restore_last_successful_deploy_missing");
  }

  if (
    hasMigrationMutationAcrossCommits(
      firstParentMigrationDiffs(previousHead),
    )
  ) {
    throw new Error("remote_restore_applied_migration_mutation");
  }

  const changedWithStatus = execFileSync(
    "git",
    [
      "diff",
      "--name-status",
      "--no-renames",
      `${previousHead}..HEAD`,
      "--",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const changed = changedPathsFromNameStatus(changedWithStatus);
  return {
    migrationBearing: hasMigrationChanges(changed),
    restoreCritical: hasRestoreCriticalChanges(changed),
  };
}

async function main() {
  const manifestPath = readArg("--manifest");
  const evidencePath = readArg("--remote-evidence");
  if (!manifestPath || !evidencePath)
    throw new Error("remote_restore_evidence_arguments_missing");
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  let evidence = null;
  try {
    evidence = JSON.parse(readFileSync(resolve(evidencePath), "utf8"));
  } catch {
    // A missing or malformed evidence file is validation failure, not a
    // verifier-infrastructure failure, and may trigger a protected refresh.
  }
  const migrations = readdirSync(resolve("migrations"))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  const { migrationBearing, restoreCritical } =
    await restoreEvidenceClassification();
  const allowedMigrationStates = allowedProductionMigrationLedgers(
    migrations,
  ).map((ledger) => migrationLedgerState(ledger));
  const verificationNow = new Date();
  const verdict = validateRemoteRestoreEvidence(evidence, {
    candidateFingerprint: manifest.candidateFingerprint,
    wranglerWorktreeSha256:
      manifest.postflight?.launchConfig?.wranglerWorktreeSha256,
    allowedMigrationStates,
    migrationBearing,
    restoreCritical,
    now: verificationNow,
    minimumValidityMs: minimumValidityMs(),
  });
  const exactEvidenceRequired = migrationBearing || restoreCritical;
  process.stdout.write(
    `${JSON.stringify({ ...verdict, policy: exactEvidenceRequired ? "fresh-exact-24h" : "verified-ledger-7d" })}\n`,
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
    process.exitCode = 2;
  }
}
