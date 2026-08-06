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
 * newest successful production deploy. It used to be a commit SHA written into
 * the deploy plan by hand, which is a guarantee with an expiry date: the moment
 * any migration landed after that commit, every deferred release failed forever,
 * for a change that shipped a week earlier. That is exactly what happened on
 * 2026-08-06 — the pinned commit was six days old, four migrations had landed
 * since, and the gate rejected releases whose schema was identical to
 * production's, while reporting it as `git diff --quiet ... failed`.
 *
 * Reading the live commit each run means the gate cannot go stale: whatever is
 * live IS the baseline, and it moves forward on its own with every release.
 *
 * Fails closed. If the live commit cannot be resolved or its objects cannot be
 * fetched, this exits non-zero: "I could not check" must never read as "safe".
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = process.env.GITHUB_REPOSITORY || "nish3451/0509";
const DEPLOY_WORKFLOW =
  process.env.DEPLOY_WORKFLOW_FILE || "deploy-production.yml";
const MIGRATIONS_PATH = "migrations";

/** Run a command and hand back status plus output, never throwing on failure. */
function run(command, args) {
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

function fail(reason, detail) {
  process.stdout.write(`${JSON.stringify({ ok: false, reason, detail })}\n`);
  console.error(`\n${detail}\n`);
  process.exit(1);
}

/** The commit currently serving production: head of the newest successful deploy. */
function resolveLiveSha() {
  const explicit = (process.env.LIVE_RELEASE_SHA || "").trim();
  if (explicit) {
    if (!/^[0-9a-f]{40}$/u.test(explicit)) {
      fail(
        "invalid_live_release_sha",
        `LIVE_RELEASE_SHA is set but is not a full 40-character commit sha: ${explicit}`,
      );
    }
    return explicit;
  }

  const listed = run("gh", [
    "run",
    "list",
    "--repo",
    REPO,
    "--workflow",
    DEPLOY_WORKFLOW,
    "--status",
    "success",
    "--limit",
    "1",
    "--json",
    "headSha",
  ]);
  if (listed.status !== 0) {
    fail(
      "live_release_lookup_failed",
      "Could not ask GitHub which commit is live (needs GH_TOKEN and the " +
        `${DEPLOY_WORKFLOW} workflow). Refusing to assume the schema is ` +
        `unchanged.\n${listed.stderr}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(listed.stdout || "[]");
  } catch (error) {
    fail(
      "live_release_unparsable",
      `Could not read the live release lookup as JSON: ${error.message}`,
    );
  }
  const sha = Array.isArray(parsed) ? parsed[0]?.headSha : undefined;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/u.test(sha)) {
    fail(
      "no_successful_release_found",
      "No successful production deploy was found, so there is no live commit " +
        "to compare against. A first release, or one after a long run of " +
        "failures, must ship with real backup proof rather than deferred.",
    );
  }
  return sha;
}

/** CI clones are shallow; the live commit may simply not be present yet. */
function ensureCommitPresent(sha) {
  if (run("git", ["cat-file", "-e", `${sha}^{commit}`]).status === 0) {
    return;
  }
  const fetched = run("git", ["fetch", "--depth", "1", "origin", sha]);
  if (
    fetched.status !== 0 &&
    run("git", ["cat-file", "-e", `${sha}^{commit}`]).status !== 0
  ) {
    fail(
      "live_commit_unavailable",
      `The live commit ${sha.slice(0, 8)} is not in this checkout and could ` +
        `not be fetched, so the schema comparison could not run.\n${fetched.stderr}`,
    );
  }
}

const liveSha = resolveLiveSha();
ensureCommitPresent(liveSha);

// `git diff --quiet` signals with its exit code: 0 = identical, 1 = differs.
// Anything else is a real git error and must not be read as either answer.
const diff = run("git", [
  "diff",
  "--quiet",
  liveSha,
  "HEAD",
  "--",
  MIGRATIONS_PATH,
]);

if (diff.status === 0) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, liveSha, migrationsChanged: false })}\n`,
  );
  process.exit(0);
}

if (diff.status === 1) {
  const changed = run("git", [
    "diff",
    "--name-only",
    liveSha,
    "HEAD",
    "--",
    MIGRATIONS_PATH,
  ]).stdout;
  fail(
    "deferred_release_changes_schema",
    "This release changes the database schema, and it was authorised to ship " +
      "WITHOUT fresh backup proof. That combination is not allowed.\n\n" +
      `Compared against what is live right now (${liveSha.slice(0, 8)}), these ` +
      `migration files differ:\n${changed}\n\n` +
      "Either run the D1 remote restore evidence workflow for this candidate " +
      "and ship with real backup proof, or drop the migration changes from " +
      "this release.",
  );
}

fail(
  "schema_comparison_failed",
  `git could not compare migrations against the live commit ${liveSha.slice(0, 8)} ` +
    `(exit ${diff.status}). Refusing to assume the schema is unchanged.\n${diff.stderr}`,
);
