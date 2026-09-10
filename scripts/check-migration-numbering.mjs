#!/usr/bin/env node
/**
 * Block a PR whose newly added migration does not sort last.
 *
 * Detector half of #2507. A duplicate migration number — `0088_org_scoped_
 * ownership.sql` landing after `0088_recreate_delivery_hot_path_indexes.sql`
 * was already applied — took every production deploy down, and nothing caught
 * it at PR time. The repo carries historical duplicate numbers (0067, 0087,
 * 0088) that are already live, so this gate does NOT enforce global uniqueness:
 * those must keep passing. The rule is strictly "a newly added migration must
 * sort after every migration on the base branch".
 *
 * For every migration ADDED in this PR (diff against the merge base with the
 * base branch), fail if its 4-digit prefix is less than or equal to the
 * highest 4-digit prefix among migrations that already exist on the base
 * branch. A new `0089` when the base tops out at `0089` fails (duplicating the
 * top); a new `0088` fails (below the top); a new `0090` passes; a PR that
 * touches no migrations passes; the historical duplicates already on the base
 * branch do not trip it because they are not "added in this PR".
 *
 * Fails closed: if the base branch or the added-files list cannot be resolved,
 * the gate exits non-zero — "I could not check" must never read as "safe" on
 * the guard in front of a deploy.
 *
 * A rename is also covered. `--diff-filter=A` cannot see `git mv`, so renaming
 * `0090_old.sql` to `0001_new.sql` would plant a low-numbered migration with
 * the gate reporting OK. The diff is read with `--name-status -M` and a rename
 * fails when the prefix DROPS. A rename that keeps or raises its prefix (tidying
 * a filename) stays legal.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const MIGRATIONS_PATH = "migrations";
export const BASE_REF = "origin/main";
export const PREFIX_RE = /^(\d{4})_/u;

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
 * The 4-digit numeric prefix of a migration path, or null if it is not a
 * numbered `.sql` migration. `migrations/0090_new.sql` -> 90; a README or
 * non-conforming name -> null (ignored, not a migration).
 *
 * @param {string} path
 * @returns {number | null}
 */
export function migrationPrefix(path) {
  const base = path.split("/").pop() ?? "";
  if (!base.endsWith(".sql")) return null;
  const match = PREFIX_RE.exec(base);
  return match ? Number(match[1]) : null;
}

/**
 * List migration files on the base branch (origin/main by default).
 *
 * Uses `git ls-tree -r` so a flat or nested `migrations/` both work; only
 * entries under `migrations/` are returned.
 *
 * @param {Exec} [exec]
 * @param {string} [baseRef]
 * @returns {string[]}
 */
export function listBaseMigrations(exec = defaultExec, baseRef = BASE_REF) {
  const result = exec("git", [
    "ls-tree", "-r", "--name-only", baseRef, "--", MIGRATIONS_PATH,
  ]);
  if (result.status !== 0) {
    throw new GateRefusal(
      "base_ref_unavailable",
      `Could not list migrations on the base branch (${baseRef}). The gate ` +
        "cannot confirm a new migration sorts last without knowing what is " +
        `already there.\n${result.stderr}`,
    );
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${MIGRATIONS_PATH}/`));
}

/**
 * The highest 4-digit prefix among numbered migrations on the base branch.
 * Returns -1 when the base branch has no numbered migrations (a fresh repo).
 *
 * @param {Exec} [exec]
 * @param {string} [baseRef]
 * @returns {number}
 */
export function baseTopPrefix(exec = defaultExec, baseRef = BASE_REF) {
  const files = listBaseMigrations(exec, baseRef);
  let top = -1;
  for (const path of files) {
    const n = migrationPrefix(path);
    if (n !== null && n > top) top = n;
  }
  return top;
}

/**
 * Migrations added in this PR, relative to the merge base with the base
 * branch (`origin/main...HEAD`). Returns full paths like
 * `migrations/0090_new.sql`.
 *
 * @param {Exec} [exec]
 * @param {string} [baseRef]
 * @returns {string[]}
 */
export function listAddedMigrations(exec = defaultExec, baseRef = BASE_REF) {
  return diffMigrations(exec, baseRef).added;
}

/**
 * Migrations renamed in this PR, as `{ from, to }` pairs, relative to the
 * merge base with the base branch.
 *
 * A rename is not "added" (`--diff-filter=A` skips it), so a PR that renames
 * `0090_old.sql` to `0001_new.sql` would otherwise slip a low-numbered
 * migration past this gate — the exact incident class it exists to catch. The
 * gate compares the rename's before/after prefixes instead of ignoring it.
 *
 * @param {Exec} [exec]
 * @param {string} [baseRef]
 * @returns {{ from: string, to: string }[]}
 */
export function listRenamedMigrations(exec = defaultExec, baseRef = BASE_REF) {
  return diffMigrations(exec, baseRef).renamed;
}

/**
 * One `git diff --name-status -M` against the merge base, split into added
 * paths and rename pairs. `-M` makes git report a rename as a rename rather
 * than a delete+add, so the gate can judge the new prefix against the old one.
 *
 * @param {Exec} exec
 * @param {string} baseRef
 * @returns {{ added: string[], renamed: { from: string, to: string }[] }}
 */
function diffMigrations(exec, baseRef) {
  const result = exec("git", [
    "diff", "--name-status", "-M", "--diff-filter=AR", `${baseRef}...HEAD`,
    "--", MIGRATIONS_PATH,
  ]);
  if (result.status !== 0) {
    throw new GateRefusal(
      "added_migrations_lookup_failed",
      `Could not list migrations added in this PR (diff against ${baseRef}).\n${result.stderr}`,
    );
  }

  /** @param {string} p */
  const isMigration = (p) => p.startsWith(`${MIGRATIONS_PATH}/`);
  /** @type {string[]} */
  const added = [];
  /** @type {{ from: string, to: string }[]} */
  const renamed = [];
  for (const raw of result.stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (status.startsWith("A") && parts[1] && isMigration(parts[1])) {
      added.push(parts[1]);
    } else if (status.startsWith("R") && parts[1] && parts[2]) {
      // Only a rename that stays inside migrations/ concerns this gate.
      if (isMigration(parts[1]) && isMigration(parts[2])) {
        renamed.push({ from: parts[1], to: parts[2] });
      }
    }
  }
  return { added, renamed };
}

/**
 * Run the gate. Returns `{ ok, added, baseTop }` on success, throws
 * GateRefusal naming every offending file on failure.
 *
 * @param {Exec} [exec]
 * @param {string} [baseRef]
 * @returns {{ ok: true, added: string[], baseTop: number }}
 */
export function checkMigrationNumbering(exec = defaultExec, baseRef = BASE_REF) {
  const baseTop = baseTopPrefix(exec, baseRef);
  const { added, renamed } = diffMigrations(exec, baseRef);

  /** @param {number} n */
  const pad = (n) => String(n).padStart(4, "0");

  const offenders = [];
  const prefixToPath = new Map();
  const dupes = [];
  for (const path of added) {
    const n = migrationPrefix(path);
    if (n === null) continue; // not a numbered migration; not this gate's concern
    if (n <= baseTop) {
      offenders.push({ path, number: n });
    }
    // A prefix used more than once in the SAME PR would recreate the exact
    // duplicate-number incident, even when both sort above the base top.
    // Historical duplicates already on the base branch stay untouched.
    if (prefixToPath.has(n)) {
      dupes.push({ number: n, paths: [/** @type {string} */ (prefixToPath.get(n)), path] });
    } else {
      prefixToPath.set(n, path);
    }
  }

  const messages = [];
  if (offenders.length > 0) {
    const required = baseTop + 1;
    messages.push(
      "A newly added migration must sort after every migration on the base " +
        `branch. The base branch (${baseRef}) tops out at ${pad(baseTop)}.\n\n` +
        `Offending migration(s) (must renumber to sort last):\n` +
        offenders
          .map(
            (o) =>
              `  ${o.path} (prefix ${pad(o.number)}) — must sort after ${pad(baseTop)}; ` +
              `use ${pad(required)} or higher`,
          )
          .join("\n"),
    );
  }
  if (dupes.length > 0) {
    messages.push(
      "A newly added migration must not duplicate another migration added in " +
        "the same PR.\n\n" +
        `Duplicated prefix(es):\n` +
        dupes
          .map(
            (d) =>
              `  ${pad(d.number)} used by both:\n` +
              d.paths.map((p) => `    - ${p}`).join("\n"),
          )
          .join("\n"),
    );
  }

  // A rename that LOWERS a migration's prefix plants a low-numbered file just
  // as surely as adding one, and `--diff-filter=A` cannot see it. A rename
  // that keeps or raises the prefix is legitimate (tidying a filename) and
  // must keep passing, which is why this compares old vs new rather than
  // applying the blanket `<= baseTop` rule to the new path.
  const loweringRenames = [];
  for (const { from, to } of renamed) {
    const before = migrationPrefix(from);
    const after = migrationPrefix(to);
    if (before === null || after === null) continue;
    if (after < before) loweringRenames.push({ from, to, before, after });
  }
  if (loweringRenames.length > 0) {
    messages.push(
      "A migration must not be renamed to a lower number. A rename is not " +
        "\"added\" for diff purposes, so it would otherwise plant a " +
        "low-numbered migration without this gate seeing it.\n\n" +
        `Renamed to a lower prefix:\n` +
        loweringRenames
          .map(
            (r) =>
              `  ${r.from} (${pad(r.before)}) -> ${r.to} (${pad(r.after)})`,
          )
          .join("\n"),
    );
  }

  if (messages.length > 0) {
    throw new GateRefusal(
      "migration_not_sorting_last",
      messages.join("\n\n") +
        "\n\nRenumber the file(s) above to sort last and stay distinct within this PR, " +
        "or drop them if unintended.",
    );
  }

  return { ok: true, added, baseTop };
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  try {
    const result = checkMigrationNumbering();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error instanceof GateRefusal) {
      console.error(`\n${error.detail}\n`);
      process.exit(1);
    }
    throw error;
  }
}
