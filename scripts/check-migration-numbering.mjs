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
  const result = exec("git", [
    "diff", "--name-only", "--diff-filter=A", `${baseRef}...HEAD`, "--", MIGRATIONS_PATH,
  ]);
  if (result.status !== 0) {
    throw new GateRefusal(
      "added_migrations_lookup_failed",
      `Could not list migrations added in this PR (diff against ${baseRef}).\n${result.stderr}`,
    );
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${MIGRATIONS_PATH}/`));
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
  const added = listAddedMigrations(exec, baseRef);

  const offenders = [];
  for (const path of added) {
    const n = migrationPrefix(path);
    if (n === null) continue; // not a numbered migration; not this gate's concern
    if (n <= baseTop) {
      offenders.push({ path, number: n });
    }
  }

  if (offenders.length > 0) {
    /** @param {number} n */
    const pad = (n) => String(n).padStart(4, "0");
    const required = baseTop + 1;
    const lines = offenders.map(
      (o) =>
        `  ${o.path} (prefix ${pad(o.number)}) — must sort after ${pad(baseTop)}; ` +
        `use ${pad(required)} or higher`,
    );
    throw new GateRefusal(
      "migration_not_sorting_last",
      "A newly added migration must sort after every migration on the base " +
        `branch. The base branch (${baseRef}) tops out at ${pad(baseTop)}.\n\n` +
        `Offending migration(s):\n${lines.join("\n")}\n\n` +
        "Renumber the file(s) above to sort last, or drop them if unintended.",
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
