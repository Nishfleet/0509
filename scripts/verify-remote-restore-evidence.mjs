#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRemoteRestoreEvidence } from "./deploy-production-plan.mjs";
import {
  allowedProductionMigrationLedgers,
  migrationLedgerState,
} from "./d1-migration-sync-check.lib.mjs";
import {
  DEPLOY_LEDGER_PATH,
  parseDeployLedgerRows,
} from "./deploy-ledger.mjs";

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
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", previousHead, "HEAD"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch {
    // Same assertion as before; only the failure text changed. A rewrite
    // leaves the pinned SHA unknown (`git cat-file -e` fails) or known but
    // not an ancestor — both must name the remedy, not a bare Command failed.
    throw new Error(pinnedEvidenceShaNotInHistoryIssue(previousHead));
  }
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

export const PINNED_EVIDENCE_SHA_NOT_IN_HISTORY =
  "pinned evidence SHA is not in this history — regenerate the evidence";

/**
 * Named failure for a pin that `git cat-file -e` cannot see, or that
 * `--is-ancestor` rejects. The phrase is the contract 0509#2974 checks.
 *
 * @param {string} sha
 */
export function pinnedEvidenceShaNotInHistoryIssue(sha) {
  const present = spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (present.error) throw present.error;
  const kind =
    present.status === 0
      ? "known but not an ancestor of HEAD"
      : "unknown to this checkout";
  return `${PINNED_EVIDENCE_SHA_NOT_IN_HISTORY} (${sha} is ${kind})`;
}

/** Run git silently; true only on a clean exit. @param {string[]} args */
function gitOk(args) {
  try {
    execFileSync("git", args, { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

/**
 * True only when `sha` is reachable from HEAD — "exists as an object" is not
 * enough: rewrite-stranded commits linger unreachable and cannot anchor
 * previousHead..HEAD.
 * @param {string} sha
 */
export function reachableFromHead(sha) {
  return gitOk(["merge-base", "--is-ancestor", sha, "HEAD"]);
}

/**
 * Fetch the commit object from origin when the checkout lacks it — a
 * rewrite-stranded head usually still exists in the remote object store.
 * @param {string} sha
 */
export function ensureCommitObjectPresent(sha) {
  const present = () => gitOk(["cat-file", "-e", `${sha}^{commit}`]);
  if (present()) return true;
  gitOk(["fetch", "--quiet", "--no-tags", "origin", sha]);
  return present();
}

/**
 * @param {string} sha
 * @returns {string | null} the commit's tree hash, or null when unavailable
 */
export function treeHashOfCommit(sha) {
  try {
    const tree = execFileSync("git", ["rev-parse", `${sha}^{tree}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[a-f0-9]{40}$/u.test(tree) ? tree : null;
  } catch {
    return null;
  }
}

/**
 * The newest commit on HEAD's first-parent chain whose tree equals `tree`:
 * tree equality is identical content, so a rewritten-away deploy head and
 * its replacement resolve to the same anchor regardless of SHA.
 * @param {string} tree
 * @returns {string | null}
 */
export function newestFirstParentCommitWithTree(tree) {
  if (!/^[a-f0-9]{40}$/u.test(tree)) return null;
  const listing = execFileSync(
    "git",
    ["log", "--first-parent", "--format=%H %T", "HEAD"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const line of listing.split(/\r?\n/u)) {
    const [sha, commitTree] = line.trim().split(" ");
    if (commitTree === tree && /^[a-f0-9]{40}$/u.test(sha)) return sha;
  }
  return null;
}

/**
 * The committed deploy ledger, read out of HEAD's own tree so it survives a
 * history rewrite and a wiped runs API. Absent or unreadable is not an error.
 * @returns {Array<{ sha: string, tree: string | null, deployed_at: string, version_id: string | null }>}
 */
export function readDeployLedgerRows() {
  let text;
  try {
    text = execFileSync(
      "git",
      ["show", `HEAD:${DEPLOY_LEDGER_PATH}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return [];
  }
  return parseDeployLedgerRows(text);
}

/**
 * Anchor on the newest deploy-ledger row that resolves in this history — a
 * reachable recorded sha directly, a rewrite-stranded one by its tree.
 * @param {{ rows?: Array<{ sha: string, tree: string | null }>, reachable?: (sha: string) => boolean, treeMatch?: (tree: string) => string | null, head?: string }} [args]
 * @returns {string | null}
 */
export function deployLedgerAnchor({
  rows = readDeployLedgerRows(),
  reachable = reachableFromHead,
  treeMatch = newestFirstParentCommitWithTree,
  head = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim(),
} = {}) {
  for (const row of [...rows].reverse()) {
    // The ledger file is committed content, so a row is weaker evidence than
    // a recorded run head. Never let it anchor on HEAD itself: that would
    // make the classification diff empty and silently downgrade the release
    // to the weaker verified-ledger-7d policy (the same failure the
    // bootstrap's is-head refusal exists to prevent).
    if (reachable(row.sha) && row.sha !== head) return row.sha;
    if (row.tree) {
      const match = treeMatch(row.tree);
      if (match && match !== head) return match;
    }
  }
  return null;
}

/**
 * Resolve a recorded last-successful head that is not reachable from HEAD —
 * the history-rewrite recovery chain (0509#2975): first by tree hash (fetch
 * the recorded object if absent, then take the newest first-parent commit on
 * main with the same tree — e.g. 2026-09-11 d16b1f00 -> 20382d7e), then by
 * the committed deploy ledger when the object itself is gone; null means the
 * caller falls through to the operator bootstrap.
 * @param {string} recordedHead
 * @param {{ warn?: (message: string) => void, ensureObject?: (sha: string) => boolean, treeOf?: (sha: string) => string | null, treeMatch?: (tree: string) => string | null, ledgerRows?: () => Array<{ sha: string, tree: string | null }>, reachable?: (sha: string) => boolean }} [deps]
 * @returns {string | null}
 */
export function resolveRewrittenRecordedHead(recordedHead, deps = {}) {
  const {
    warn = (message) => process.stderr.write(`${message}\n`),
    ensureObject = ensureCommitObjectPresent,
    treeOf = treeHashOfCommit,
    treeMatch = newestFirstParentCommitWithTree,
    ledgerRows = readDeployLedgerRows,
    reachable = reachableFromHead,
  } = deps;
  const fetched = ensureObject(recordedHead);
  const tree = fetched ? treeOf(recordedHead) : null;
  const match = tree ? treeMatch(tree) : null;
  if (match) {
    warn(
      `::warning::recorded last successful deploy ${recordedHead} is not reachable from HEAD after a main history rewrite; anchoring on ${match}, the newest first-parent commit carrying the identical tree ${tree}.`,
    );
    return match;
  }
  warn(
    `::warning::recorded head ${fetched ? "has no first-parent tree match" : "object could not be fetched"}; consulting the committed deploy ledger.`,
  );
  const ledgerAnchor = deployLedgerAnchor({ rows: ledgerRows(), reachable, treeMatch });
  if (ledgerAnchor) {
    warn(
      `::warning::anchoring on committed deploy-ledger.jsonl entry ${ledgerAnchor} because the recorded head cannot be resolved by sha or tree.`,
    );
    return ledgerAnchor;
  }
  return null;
}

/**
 * Pick the anchor for previousHead..HEAD. A recorded last-success head wins
 * whenever it resolves in this history; a rewrite-stranded one is recovered
 * by tree hash, then by the committed deploy ledger, and only then by the
 * operator bootstrap — or the run fails with a named reason, not a raw git
 * error.
 * @param {{ recordedHead: string | null }} args
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(message: string) => void} [warn]
 * @param {(sha: string) => boolean} [reachable]
 * @param {{ resolveRewritten?: (sha: string) => string | null, ledgerAnchor?: () => string | null }} [deps] test seam; production callers use the git defaults
 */
export function anchorPreviousHead(
  { recordedHead },
  env = process.env,
  warn = (message) => process.stderr.write(`${message}\n`),
  reachable = reachableFromHead,
  deps = {},
) {
  const {
    resolveRewritten = (sha) =>
      resolveRewrittenRecordedHead(sha, { warn, reachable }),
    ledgerAnchor: findLedgerAnchor = () => deployLedgerAnchor({ reachable }),
  } = deps;
  if (recordedHead && reachable(recordedHead)) {
    bootstrapPreviousSuccessHead({ hasRecordedHistory: true }, env, warn);
    return recordedHead;
  }
  if (recordedHead) {
    warn(
      `::warning::recorded last successful production deploy ${recordedHead} is not reachable from HEAD (main rewritten?). It cannot anchor previousHead..HEAD directly; attempting tree-hash and deploy-ledger resolution before the operator bootstrap.`,
    );
    const resolved = resolveRewritten(recordedHead);
    if (resolved && /^[a-f0-9]{40}$/u.test(resolved) && reachable(resolved)) {
      // Recovered real history — a set bootstrap is ignored loudly, the same
      // contract as a reachable recorded head.
      bootstrapPreviousSuccessHead({ hasRecordedHistory: true }, env, warn);
      return resolved;
    }
    const bootstrapped = bootstrapPreviousSuccessHead(
      { hasRecordedHistory: false },
      env,
      warn,
    );
    if (!bootstrapped) {
      throw new Error(pinnedEvidenceShaNotInHistoryIssue(recordedHead));
    }
    return bootstrapped;
  }
  // No recorded run head at all (the 2026-08-19 repo rename zeroed the runs
  // API). The committed deploy ledger is real recorded history written by the
  // deploy job itself, so a usable row outranks the operator bootstrap.
  const ledgerAnchor = findLedgerAnchor();
  if (ledgerAnchor) {
    bootstrapPreviousSuccessHead({ hasRecordedHistory: true }, env, warn);
    return ledgerAnchor;
  }
  return bootstrapPreviousSuccessHead({ hasRecordedHistory: false }, env, warn);
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
  /^(?:wrangler\.jsonc|\.node-version|package(?:-lock)?\.json|\.github\/workflows\/(?:deploy-production|d1-backup-r2|d1-remote-restore-evidence|d1-restore-proof-auto-refresh)\.yml|scripts\/(?:customer-readiness-candidate|deploy-production-plan|deploy-ledger|safe-command-output|validate-d1-backup|build-remote-restore-candidate-manifest|find-recent-remote-restore-artifact|verify-remote-restore-evidence|d1-(?:backup|migration-sync|remote-restore|restore)[^/]*)\.mjs)$/u;

/** @param {unknown} diffOutput */
export function hasRestoreCriticalChanges(diffOutput) {
  return String(diffOutput)
    .split(/\r?\n/u)
    .some((name) => RESTORE_CRITICAL_PATH_PATTERN.test(name.trim()));
}

export async function restoreEvidenceClassification() {
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
  const recorded = Array.isArray(payload?.workflow_runs)
    ? payload.workflow_runs.filter(
        (run) =>
          Number(run?.id) !== currentRunId &&
          run?.conclusion === "success" &&
          /^[a-f0-9]{40}$/u.test(run?.head_sha ?? ""),
      )
    : [];
  const recordedInHistory = recorded.find((run) =>
    reachableFromHead(String(run.head_sha)),
  );
  // Recorded run history always wins. The bootstrap anchor is consulted only
  // when this successful query found no eligible run at all, and is ignored
  // (loudly) whenever one exists — see bootstrapPreviousSuccessHead. The one
  // exception (0509#2975): a recorded head that is not in this history at all
  // (main was rewritten, fleet-ops#5385) cannot anchor anything, so it is
  // recovered by tree hash, then by the committed deploy ledger; when nothing
  // resolves, anchorPreviousHead throws the named pinned-evidence error, the
  // caller turns it into a verdict (exit 1) that names the remedy — never a
  // bare Command failed infrastructure crash (exit 2) — so
  // prepare_remote_restore_evidence can fall through to generate_restore_evidence.
  let previousHead;
  try {
    previousHead = anchorPreviousHead({
      recordedHead: recordedInHistory
        ? String(recordedInHistory.head_sha)
        : recorded[0]
          ? String(recorded[0].head_sha)
          : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes(PINNED_EVIDENCE_SHA_NOT_IN_HISTORY)) throw error;
    return {
      migrationBearing: true,
      restoreCritical: true,
      orphanedDeployAnchor: String(recorded[0].head_sha),
    };
  }
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
  const { migrationBearing, restoreCritical, orphanedDeployAnchor } =
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
  if (orphanedDeployAnchor) {
    // Force a verdict failure (exit 1, not 2) so prepare falls through to
    // generate_restore_evidence and produces exact evidence for this SHA.
    verdict.ok = false;
    verdict.issues.push(pinnedEvidenceShaNotInHistoryIssue(orphanedDeployAnchor));
  }
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
    const message =
      error instanceof Error
        ? error.message
        : "remote_restore_evidence_unavailable";
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        issues: [message],
      })}\n`,
    );
    // Named rewrite failure is a verdict (exit 1): prepare then generates
    // fresh exact evidence. Other throws remain infrastructure (exit 2).
    process.exitCode = message.includes(PINNED_EVIDENCE_SHA_NOT_IN_HISTORY)
      ? 1
      : 2;
  }
}
