#!/usr/bin/env node
/**
 * Deferred releases must not carry a schema change.
 *
 * When a release ships with `backup_proof_status: deferred`, nobody has proved a
 * fresh restore for this candidate. That is only safe while the release leaves
 * the database schema exactly as production already has it, so this gate blocks
 * a deferred release that touches `migrations/`.
 *
 * The comparison point is what is CURRENTLY LIVE, resolved at run time from the
 * newest successful production deploy. It used to be a commit sha written into
 * the deploy plan by hand, which is a guarantee with an expiry date: the moment
 * any migration landed after that commit, every deferred release failed forever,
 * for a change that shipped a week earlier. That is exactly what happened on
 * 2026-08-06 — the pinned commit was six days old, four migrations had landed
 * since, and the gate rejected releases whose schema was identical to
 * production's, while reporting it only as `git diff --quiet ... failed`.
 *
 * Reading the live commit each run means the gate cannot go stale: whatever is
 * live IS the baseline, and it moves forward on its own with every release.
 *
 * Why "newest successful deploy" is the right baseline: `migration_sync` runs on
 * every deploy and enforces that remote D1 matches the repo's `migrations/`, so
 * a successful run's tree provably equals the live schema. An in-run rollback
 * happens inside a FAILED run, which this never sees, and rolls back the worker
 * rather than D1 — so the baseline correctly stays at the newer sha.
 *
 * KNOWN residual case, deliberately left strict: if a required release applies
 * migrations to D1 and then fails after deploy, D1 holds migrations that the
 * newest successful run's tree does not. Deferred candidates containing those
 * files are then blocked until a successful required release advances the
 * baseline. That is the safe direction — it over-blocks rather than under-blocks
 * — but it is the same symptom this gate was written to remove, with a narrower
 * trigger. If you are reading this while diagnosing exactly that, you are in the
 * right place: ship the pending required release rather than weakening this.
 *
 * Fails closed. If the live commit cannot be resolved or its objects cannot be
 * fetched, the gate exits non-zero: "I could not check" must never read as
 * "safe" on the guard in front of a database.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const REPO = "Nishfleet/0509";
export const DEPLOY_WORKFLOW = "deploy-production.yml";
export const MIGRATIONS_PATH = "migrations";
export const SHA_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * Where the resolved baseline is recorded for the Gate C journal, so the
 * evidence states the baseline that was really used rather than a constant.
 */
export const BASELINE_EVIDENCE_PATH = "test-results/deferred-release-baseline.json";

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} ExecResult
 * @typedef {(command: string, args: string[]) => ExecResult} Exec
 */

/** Thrown for every refusal, so the CLI can render one and exit non-zero. */
export class GateRefusal extends Error {
  /** @param {string} reason @param {string} detail */
  constructor(reason, detail) {
    super(detail);
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * Default executor. Never throws: a spawn error is just a non-zero result.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {ExecResult}
 */
export function defaultExec(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.error ? 1 : (result.status ?? 1),
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim() || (result.error?.message ?? ""),
  };
}

/**
 * The commit currently serving production: head of the newest successful deploy.
 *
 * Deliberately takes no environment override. An override here would let a
 * single `env:` line point the baseline at the candidate's own HEAD, making the
 * diff empty and waving a schema-carrying deferred release straight through —
 * silently, because the success output would look identical. This repo's
 * standard for the deferred path is exact-value, actor-bound authorization, and
 * a gate that any env var can neutralise does not meet it. Tests inject `exec`
 * instead.
 */
export function resolveLiveSha(exec = defaultExec) {
  const listed = exec("gh", [
    "run", "list",
    "--repo", REPO,
    "--workflow", DEPLOY_WORKFLOW,
    "--status", "success",
    "--limit", "1",
    "--json", "headSha",
  ]);
  if (listed.status !== 0) {
    throw new GateRefusal(
      "live_release_lookup_failed",
      "Could not ask GitHub which commit is live (needs GH_TOKEN and " +
        `${DEPLOY_WORKFLOW}). Refusing to assume the schema is unchanged.\n${listed.stderr}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(listed.stdout || "[]");
  } catch (error) {
    throw new GateRefusal(
      "live_release_unparsable",
      "Could not read the live release lookup as JSON: " +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const sha = Array.isArray(parsed) ? parsed[0]?.headSha : undefined;
  if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
    throw new GateRefusal(
      "no_successful_release_found",
      "No successful production deploy was found, so there is no live commit " +
        "to compare against. A first release, or one after a long run of " +
        "failures, must ship with real backup proof rather than deferred.",
    );
  }
  return sha;
}

/**
 * Make sure the baseline commit is readable here.
 *
 * The deploy job checks out with full history, so this is normally a no-op. The
 * fetch is a fallback for shallow contexts. Success is judged by whether the
 * object is actually present afterwards, never by the fetch's exit code — a
 * fetch that reports success without materialising the commit must still refuse.
 *
 * @param {string} sha
 * @param {Exec} [exec]
 */
export function ensureCommitPresent(sha, exec = defaultExec) {
  const present = () => exec("git", ["cat-file", "-e", `${sha}^{commit}`]).status === 0;
  if (present()) return;
  const fetched = exec("git", ["fetch", "--depth", "1", "origin", sha]);
  if (present()) return;
  throw new GateRefusal(
    "live_commit_unavailable",
    `The live commit ${sha.slice(0, 8)} is not in this checkout and could not ` +
      `be fetched, so the schema comparison could not run.\n${fetched.stderr}`,
  );
}

/**
 * Compare `migrations/` between the baseline and HEAD.
 *
 * `git diff --quiet` reports through its exit code: 0 identical, 1 differs.
 * Anything else is a real git error and must not be read as either answer.
 *
 * @param {string} baselineSha
 * @param {Exec} [exec]
 * @returns {{ changed: boolean, files: string[] }}
 */
export function compareMigrations(baselineSha, exec = defaultExec) {
  const diff = exec("git", [
    "diff", "--quiet", baselineSha, "HEAD", "--", MIGRATIONS_PATH,
  ]);
  if (diff.status === 0) return { changed: false, files: [] };
  if (diff.status === 1) {
    const files = exec("git", [
      "diff", "--name-only", baselineSha, "HEAD", "--", MIGRATIONS_PATH,
    ]).stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    return { changed: true, files };
  }
  throw new GateRefusal(
    "schema_comparison_failed",
    `git could not compare migrations against the live commit ` +
      `${baselineSha.slice(0, 8)} (exit ${diff.status}). Refusing to assume ` +
      `the schema is unchanged.\n${diff.stderr}`,
  );
}

/** Run the whole gate. Returns the evidence on success, throws GateRefusal otherwise. */
export function checkDeferredRelease(exec = defaultExec) {
  const baselineSha = resolveLiveSha(exec);
  ensureCommitPresent(baselineSha, exec);
  const { changed, files } = compareMigrations(baselineSha, exec);
  if (changed) {
    throw new GateRefusal(
      "deferred_release_changes_schema",
      "This release changes the database schema, and it was authorised to " +
        "ship WITHOUT fresh backup proof. That combination is not allowed.\n\n" +
        `Compared against what is live right now (${baselineSha.slice(0, 8)}), ` +
        `these migration files differ:\n${files.join("\n")}\n\n` +
        "Either run the D1 remote restore evidence workflow for this candidate " +
        "and ship with real backup proof, or drop the migration changes.",
    );
  }
  return { ok: true, baselineSha, migrationFileCount: 0 };
}

/**
 * Persist the baseline so the Gate C journal records what was really used.
 *
 * @param {Record<string, unknown>} evidence
 * @param {string} [base]
 */
export function writeBaselineEvidence(evidence, base = root) {
  const target = join(base, BASELINE_EVIDENCE_PATH);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify({ schemaVersion: 1, ...evidence }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return target;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  try {
    const evidence = checkDeferredRelease();
    writeBaselineEvidence(evidence);
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    if (error instanceof GateRefusal) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, reason: error.reason })}\n`,
      );
      console.error(`\n${error.detail}\n`);
      process.exit(1);
    }
    throw error;
  }
}
