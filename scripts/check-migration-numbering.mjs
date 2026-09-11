#!/usr/bin/env node
/**
 * A newly added migration must sort LAST.
 *
 * On 2026-09-10 `0088_org_scoped_ownership.sql` landed after
 * `0088_recreate_delivery_hot_path_indexes.sql` had already been applied to
 * production: a duplicate migration number took every deploy down and nothing
 * caught it at PR time. The gate that fired
 * (`allowedProductionMigrationLedgers`) is correct but runs after merge, in
 * the deploy — the worst possible place. This is its pre-merge sibling.
 *
 * The rule is deliberately narrow: for every migration file ADDED in this PR
 * (A-diff against the merge base), its 4-digit prefix must be strictly greater
 * than the highest 4-digit prefix among migrations that already exist on the
 * base branch. Global uniqueness is NOT enforced — the repo already carries 8
 * historical duplicate numbers (0010, 0014, 0017, 0018, 0028, 0067, 0087,
 * 0088), and renumbering or renaming existing migrations is out of scope and
 * dangerous for anything already applied to D1.
 *
 * Fails closed: an unresolvable base ref is a failure, not a pass — an
 * unchecked migration numbering assertion must never read as safe.
 *
 * Run: node scripts/check-migration-numbering.mjs
 * Env overrides (used by tests): CHECK_MIGRATION_NUMBERING_BASE_REF (default
 * origin/main), CHECK_MIGRATION_NUMBERING_HEAD (default HEAD).
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

const BASE_REF =
  process.env.CHECK_MIGRATION_NUMBERING_BASE_REF || "origin/main";
const HEAD_REF = process.env.CHECK_MIGRATION_NUMBERING_HEAD || "HEAD";
const MIGRATIONS_DIR = "migrations";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function migrationNumber(file) {
  const basename = file.split("/").pop() || "";
  if (!basename.endsWith(".sql")) return null;
  const match = /^(\d{4})_/.exec(basename);
  return match ? Number(match[1]) : null;
}

function highestBaseNumber(baseSha) {
  let numbers = [];
  try {
    const tree = git("ls-tree", "-r", "--name-only", baseSha, "--", `${MIGRATIONS_DIR}/`);
    numbers = tree
      .split("\n")
      .filter((line) => line.endsWith(".sql"))
      .map(migrationNumber)
      .filter((n) => n !== null);
  } catch (error) {
    console.error(
      `FAIL: could not list migrations on base ref ${BASE_REF} (${baseSha}): ${error.message}`,
    );
    process.exit(1);
  }
  return numbers.length ? Math.max(...numbers) : 0;
}

function main() {
  let baseSha;
  try {
    baseSha = git("merge-base", BASE_REF, HEAD_REF);
  } catch (error) {
    console.error(
      `FAIL: could not resolve merge base between ${BASE_REF} and ${HEAD_REF}. ` +
        "Fetch the base branch (fetch-depth: 0) before this check — an " +
        "unresolvable base is a failure, never a pass.",
    );
    process.exit(1);
  }

  const baseTop = highestBaseNumber(baseSha);
  const minimum = baseTop + 1;

  let added = [];
  try {
    const files = git(
      "diff",
      "--name-only",
      "--diff-filter=A",
      `${baseSha}...${HEAD_REF}`,
      "--",
      `${MIGRATIONS_DIR}/`,
    );
    added = files ? files.split("\n").filter(Boolean) : [];
  } catch (error) {
    console.error(`FAIL: could not diff added migrations against base: ${error.message}`);
    process.exit(1);
  }

  const offenders = [];
  for (const file of added) {
    const number = migrationNumber(file);
    if (number === null) continue; // non-<NNNN>_*.sql files are not numbered migrations
    if (number <= baseTop) {
      offenders.push({ file, number });
    }
  }

  if (offenders.length) {
    console.error(
      "FAIL: newly added migration(s) do not sort last — duplicate or stale migration number blocks the PR.",
    );
    for (const { file, number } of offenders) {
      console.error(
        `  offending file: ${file}\n  its number: ${number}\n  required minimum: ${minimum} (highest on ${BASE_REF} is ${baseTop})`,
      );
    }
    process.exit(1);
  }

  console.log(
    `migration_numbering_ok: ${added.length} added migration(s), all above base top ${baseTop}` +
      (added.length ? "" : ` (no migrations added in this diff)`),
  );
  process.exit(0);
}

main();
