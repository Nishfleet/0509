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

/**
 * @param {unknown} diffOutput
 * @param {Set<string>} [deployedMigrations] Migrations present at the
 *   previously deployed commit. Omit to keep the strict rule.
 */
export function hasAppliedMigrationMutation(diffOutput, deployedMigrations) {
  const scoped = deployedMigrations instanceof Set;
  return String(diffOutput)
    .split(/\r?\n/u)
    .some((line) => {
      const [status = "", ...paths] = line.split("\t");
      if (status === "A") return false;
      return paths.some((name) => {
        const path = name.trim();
        if (!/^migrations\/\d{4}_.+\.sql$/u.test(path)) return false;
        // Without an explicit deployed set, stay strict: any modification or
        // deletion of any migration counts. That is the safe default for any
        // caller that cannot establish what production actually ran.
        if (!scoped) return true;
        // Scoped: only a migration that was already in the deployed tree could
        // have been applied to production, so only editing one of those is a
        // mutation. A migration introduced after the last deploy has never run
        // anywhere, and refining it before it ships is not a hazard.
        return deployedMigrations.has(path);
      });
    });
}

/**
 * @param {unknown[]} commitDiffs
 * @param {Set<string>} [deployedMigrations] Migrations present at the
 *   previously deployed commit. Omit to keep the strict rule.
 */
export function hasMigrationMutationAcrossCommits(
  commitDiffs,
  deployedMigrations,
) {
  if (!Array.isArray(commitDiffs)) {
    throw new Error("remote_restore_migration_history_invalid");
  }
  return commitDiffs.some((diff) =>
    hasAppliedMigrationMutation(diff, deployedMigrations),
  );
}

/**
 * Migration files present in the tree at `commit` — i.e. the ones the release
 * running at that commit could have applied to production.
 *
 * @param {string} commit
 * @returns {Set<string>}
 */
export function migrationsAtCommit(commit) {
  if (typeof commit !== "string" || !/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("remote_restore_migration_history_invalid");
  }
  const listed = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", commit, "--", "migrations"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Set(
    listed
      .split(/\r?\n/u)
      .map((name) => name.trim())
      .filter((name) => /^migrations\/\d{4}_.+\.sql$/u.test(name)),
  );
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

/**
 * One-time bootstrap for the last-successful-deploy chain.
 *
 * The chain anchor is normally the head SHA of the most recent successful
 * `deploy-production.yml` run. GitHub scopes that run history to the
 * repository, and renaming a repository resets it to zero (2026-08-19:
 * `nish3451/0509` -> `Nishfleet/0509`). With zero recorded successful runs no
 * deploy can ever anchor the chain, so no deploy can ever succeed, so a
 * successful run can never be recorded — a closed loop that only an operator
 * can break.
 *
 * `BOOTSTRAP_PREVIOUS_SUCCESS_SHA` breaks it exactly once, under conditions
 * that make it incapable of weakening the real gate:
 *
 * - It is consulted ONLY when the GitHub query succeeded and returned no
 *   eligible successful run. A failed query still throws
 *   `remote_restore_last_successful_deploy_unavailable` upstream, and an
 *   absent env var still throws the original
 *   `remote_restore_last_successful_deploy_missing`.
 * - When real history exists the value is ignored outright and loudly warned
 *   about, so it can never override, rewind, or reinterpret a recorded deploy.
 * - The value must be a 40-hex commit that exists in this checkout and is a
 *   STRICT ancestor of HEAD, so it can only ever name a real, already-shipped
 *   point in this branch's history — never a fabricated or future anchor, and
 *   never HEAD itself. HEAD would make the classification diff empty, which
 *   would report the release as neither migration-bearing nor
 *   restore-critical and silently downgrade the evidence policy from
 *   fresh-exact-24h to verified-ledger-7d. Recorded history may legitimately
 *   equal HEAD (nothing shipped since the last deploy); an operator-supplied
 *   anchor may not.
 *
 * @param {{ hasRecordedHistory: boolean }} options
 * @param {Record<string, string | undefined>} [env]
 * @param {(message: string) => void} [warn]
 * @returns {string | null} the bootstrap anchor, or null when none applies
 */
export function bootstrapPreviousSuccessHead(
  { hasRecordedHistory },
  env = process.env,
  warn = (message) => process.stderr.write(`${message}\n`),
) {
  const requested = env.BOOTSTRAP_PREVIOUS_SUCCESS_SHA?.trim() ?? "";
  if (hasRecordedHistory) {
    if (requested) {
      warn(
        "::warning::BOOTSTRAP_PREVIOUS_SUCCESS_SHA is set, but GitHub reports a real last successful production deploy. Ignoring the bootstrap value entirely and anchoring on recorded run history.",
      );
    }
    return null;
  }
  if (!requested) return null;
  if (!/^[a-f0-9]{40}$/u.test(requested)) {
    throw new Error("remote_restore_bootstrap_previous_head_invalid");
  }
  let resolved;
  try {
    resolved = execFileSync(
      "git",
      ["rev-parse", "--verify", `${requested}^{commit}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    throw new Error("remote_restore_bootstrap_previous_head_unknown");
  }
  if (resolved !== requested) {
    throw new Error("remote_restore_bootstrap_previous_head_unknown");
  }
  const head = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (resolved === head) {
    // An anchor of HEAD makes previousHead..HEAD empty, so the release would
    // classify as neither migration-bearing nor restore-critical and accept
    // the weaker verified-ledger-7d evidence policy. Refuse it outright.
    throw new Error("remote_restore_bootstrap_previous_head_is_head");
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", requested, "HEAD"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    throw new Error("remote_restore_bootstrap_previous_head_not_ancestor");
  }
  warn(
    `::warning::BOOTSTRAP: GitHub reports zero successful production deploys for this repository, so the last-successful-deploy chain has no anchor. Using the operator-supplied previous deployed commit ${requested} as the anchor for this run only. This path closes itself the moment one successful run is recorded.`,
  );
  return resolved;
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
  // Recorded run history always wins. The bootstrap anchor is consulted only
  // when this successful query found no eligible run at all, and is ignored
  // (loudly) whenever one exists — see bootstrapPreviousSuccessHead.
  const bootstrapHead = bootstrapPreviousSuccessHead({
    hasRecordedHistory: Boolean(previous),
  });
  const previousHead = previous ? previous.head_sha : bootstrapHead;
  if (
    typeof previousHead !== "string" ||
    !/^[a-f0-9]{40}$/u.test(previousHead)
  ) {
    throw new Error("remote_restore_last_successful_deploy_missing");
  }

  if (
    hasMigrationMutationAcrossCommits(
      firstParentMigrationDiffs(previousHead),
      migrationsAtCommit(previousHead),
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
