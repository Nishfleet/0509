import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { isolatedGitEnv } from "./helpers/git-env";

/**
 * A newly added migration must sort LAST (issue #2507, detector half of #2506).
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
 * base branch. Global uniqueness is NOT enforced — the repo already carries
 * historical duplicate numbers (0010, 0014, 0017, 0018, 0028, 0067, 0087,
 * 0088), and renumbering or renaming existing migrations is out of scope and
 * dangerous for anything already applied to D1. A duplicate WITHIN one PR is
 * still caught: two added migrations sharing a prefix mean one of them cannot
 * sort last — the #2506 incident, one release earlier.
 *
 * Fails closed: an unresolvable base ref is a failure, not a pass — an
 * unchecked migration numbering assertion must never read as safe. Three
 * adjacent bypasses are closed the same way: `--no-renames` decomposes a
 * `git mv` (R100) into D+A so a rename onto a stale number is still checked,
 * an added `.sql` that does not match `<NNNN>_*.sql` is an offender —
 * wrangler would apply it while a number-only gate never sees it — and a
 * separate rename-detection pass flags every `git mv` whose source is a
 * migration .sql on the base branch (issue #3875): production's
 * d1_migrations ledger records applied migrations by filename, so renaming a
 * base migration re-keys the ledger and the file is applied again or fails
 * the deploy — onto a strictly higher number the A-side check alone would
 * wave it through as a legitimately new migration.
 *
 * The first test in this file is the gate itself: it runs the check against
 * the real repository (origin/main...HEAD) and is wired as a named step in
 * the required `codex-node-checks` CI job, so a failure names the offending
 * file and the required minimum number directly in the check log. Ad-hoc:
 * `npx vitest run --configLoader runner --project node tests/check-migration-numbering.test.ts`
 */

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = "migrations";
const GIT_ENV = isolatedGitEnv();

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function migrationNumber(file: string): number | null {
  const basename = file.split("/").pop() ?? "";
  if (!basename.endsWith(".sql")) return null;
  const match = /^(\d{4})_/.exec(basename);
  return match ? Number(match[1]) : null;
}

interface NumberingOffender {
  file: string;
  number: number | null;
  duplicateOf: string | null;
  renamedFrom?: string;
}

interface NumberingResult {
  baseSha: string;
  baseTop: number;
  minimum: number;
  added: string[];
  offenders: NumberingOffender[];
}

function checkMigrationNumbering(
  cwd: string,
  baseRef: string,
  headRef: string,
): NumberingResult {
  // Throws when the base is unresolvable — the caller (test or CI step) fails.
  const baseSha = git(cwd, "merge-base", baseRef, headRef);

  const tree = git(
    cwd,
    "ls-tree",
    "-r",
    "--name-only",
    baseSha,
    "--",
    `${MIGRATIONS_DIR}/`,
  );
  const numbers = tree
    .split("\n")
    .filter((line) => line.endsWith(".sql"))
    .map(migrationNumber)
    .filter((n): n is number => n !== null);
  const baseTop = numbers.length ? Math.max(...numbers) : 0;

  const diff = git(
    cwd,
    "diff",
    "--name-only",
    "--diff-filter=A",
    "--no-renames",
    `${baseSha}...${headRef}`,
    "--",
    `${MIGRATIONS_DIR}/`,
  );
  const added = diff ? diff.split("\n").filter(Boolean).sort() : [];

  const offenders: NumberingOffender[] = [];

  // Renames are detected in a second pass — the A-side diff above deliberately
  // runs --no-renames, which decomposes a `git mv` into D+A and loses the link
  // between old and new paths. A rename whose source is a migration .sql on
  // the base branch is never a new migration: the production d1_migrations
  // ledger keys applied migrations by filename, so the renamed file re-keys
  // the ledger — onto a strictly higher number the A-side check would wave it
  // through as new (issue #3875). Files moved INTO migrations/ from elsewhere
  // in the repo are not ledger entries and stay on the numbering path.
  const renamedFrom = new Map<string, string>();
  const renameDiff = git(
    cwd,
    "diff",
    "--name-status",
    "--diff-filter=R",
    "--find-renames",
    `${baseSha}...${headRef}`,
  );
  for (const line of renameDiff.split("\n").filter(Boolean)) {
    const [status, from, to] = line.split("\t");
    if (
      status?.startsWith("R") &&
      from?.startsWith(`${MIGRATIONS_DIR}/`) &&
      from.endsWith(".sql") &&
      to
    ) {
      renamedFrom.set(to, from);
      offenders.push({
        file: to,
        number: migrationNumber(to),
        duplicateOf: null,
        renamedFrom: from,
      });
    }
  }

  const seenInPr = new Map<number, string>();
  for (const file of added) {
    // Rename targets already carry the more accurate rename offender.
    if (renamedFrom.has(file)) continue;
    const number = migrationNumber(file);
    if (number === null) {
      // wrangler applies every .sql under migrations/ — a non-<NNNN>_*.sql
      // name would evade a number-only gate entirely, so it fails closed.
      if (file.endsWith(".sql")) {
        offenders.push({ file, number: null, duplicateOf: null });
      }
      continue;
    }
    if (number <= baseTop) {
      offenders.push({ file, number, duplicateOf: null });
    } else if (seenInPr.has(number)) {
      offenders.push({ file, number, duplicateOf: seenInPr.get(number)! });
    } else {
      seenInPr.set(number, file);
    }
  }

  return { baseSha, baseTop, minimum: baseTop + 1, added, offenders };
}

function formatOffenders(result: NumberingResult): string {
  const lines = result.offenders.map(({ file, number, duplicateOf, renamedFrom }) =>
    renamedFrom
      ? `  offending file: ${file}\n  renamed from: ${renamedFrom}\n` +
        "  renaming a migration re-keys the production ledger — applied " +
        "migrations are recorded by filename — so the file is applied again " +
        "or fails the deploy; add a new migration instead of renaming one " +
        "that exists on the base branch"
      : number === null
      ? `  offending file: ${file}\n  its name does not match the ` +
        `${MIGRATIONS_DIR}/<NNNN>_*.sql numbering rule`
      : `  offending file: ${file}\n  its number: ${number}\n` +
        `  required minimum: ${result.minimum} (highest on base is ${result.baseTop})` +
        (duplicateOf ? `\n  duplicate of: ${duplicateOf} (added in this PR)` : ""),
  );
  return (
    "newly added migration(s) do not sort last — duplicate or stale migration " +
    `number blocks the PR.\n${lines.join("\n")}`
  );
}

const scratchRepos: string[] = [];

function gitOrThrow(repo: string, args: string[]) {
  const result = execFileSync("git", args, { cwd: repo, encoding: "utf8", env: GIT_ENV });
  return result;
}

/** Commit the given migration files on a fresh repo's main branch. */
function setupRepo(migrations: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), "mig-numbering-"));
  scratchRepos.push(repo);
  gitOrThrow(repo, ["init", "--initial-branch", "main"]);
  gitOrThrow(repo, ["config", "user.email", "test@example.com"]);
  gitOrThrow(repo, ["config", "user.name", "Test"]);
  gitOrThrow(repo, ["config", "commit.gpgsign", "false"]);
  for (const [file, content] of Object.entries(migrations)) {
    const full = join(repo, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  gitOrThrow(repo, ["add", "."]);
  gitOrThrow(repo, ["commit", "-m", "base"]);
  return repo;
}

/** Commit `file` as an added migration on a new `feature` branch. */
function addOnPr(repo: string, files: string[]) {
  gitOrThrow(repo, ["checkout", "-b", "feature"]);
  for (const file of files) {
    const full = join(repo, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "SELECT 1;");
  }
  gitOrThrow(repo, ["add", "."]);
  gitOrThrow(repo, ["commit", "-m", "added migration"]);
}

afterAll(() => {
  for (const dir of scratchRepos) rmSync(dir, { recursive: true, force: true });
});

describe("ci-migration-numbering (issue #2507)", () => {
  it("gate: every migration added in this diff sorts above the base top", () => {
    // The required-check gate itself: on a PR that adds a stale or duplicate
    // migration number this fails and formatOffenders names the file and the
    // required minimum. On clean main and on PRs adding no migrations, added
    // is empty and the check passes.
    const result = checkMigrationNumbering(REPO_ROOT, "origin/main", "HEAD");
    expect(result.offenders, formatOffenders(result)).toEqual([]);
  });

  it("passes on clean main: a diff adding no migrations has no offenders", () => {
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.baseTop).toBe(88);
    expect(result.added).toEqual([]);
    expect(result.offenders).toEqual([]);
  });

  it("passes when the added migration sorts strictly above the base top", () => {
    const repo = setupRepo({
      "migrations/0087_cta_pipeline_bail_reason_counts.sql": "SELECT 1;",
      "migrations/0087_signup_source_open_allowlist.sql": "SELECT 1;",
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    addOnPr(repo, ["migrations/0089_org_scoped_ownership.sql"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.baseTop).toBe(88);
    expect(result.added).toEqual(["migrations/0089_org_scoped_ownership.sql"]);
    expect(result.offenders).toEqual([]);
  });

  it("fails when the added migration duplicates the current top number, naming the file and the minimum", () => {
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    addOnPr(repo, ["migrations/0088_org_scoped_ownership.sql"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.offenders).toHaveLength(1);
    expect(result.offenders[0].file).toBe("migrations/0088_org_scoped_ownership.sql");
    expect(result.minimum).toBe(89);
    expect(formatOffenders(result)).toContain("migrations/0088_org_scoped_ownership.sql");
    expect(formatOffenders(result)).toContain("required minimum: 89");
  });

  it("fails when the added migration number is below the base top", () => {
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    addOnPr(repo, ["migrations/0001_dupe.sql"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.offenders).toHaveLength(1);
    expect(result.offenders[0].file).toBe("migrations/0001_dupe.sql");
    expect(result.minimum).toBe(89);
  });

  it("does not trip on historical duplicate numbers already on the base branch", () => {
    const repo = setupRepo({
      "migrations/0087_cta_pipeline_bail_reason_counts.sql": "SELECT 1;",
      "migrations/0087_signup_source_open_allowlist.sql": "SELECT 1;",
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    addOnPr(repo, ["migrations/0090_event_type_free_text.sql"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.offenders).toEqual([]);
  });

  it("fails when two migrations added in the same PR share a prefix above the base top", () => {
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    addOnPr(repo, [
      "migrations/0090_event_type_free_text.sql",
      "migrations/0090_widen_source_target_connector.sql",
    ]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.offenders).toHaveLength(1);
    expect(result.offenders[0].file).toBe(
      "migrations/0090_widen_source_target_connector.sql",
    );
    expect(result.offenders[0].duplicateOf).toBe(
      "migrations/0090_event_type_free_text.sql",
    );
    expect(formatOffenders(result)).toContain("duplicate of");
  });

  it("fails when a rename carries a migration onto a number already on base", () => {
    // A pure `git mv` is reported as R100, invisible to a bare --diff-filter=A;
    // --no-renames decomposes it into D+A so the new path is checked.
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
      "migrations/0107_old_top.sql": "SELECT 1;",
    });
    gitOrThrow(repo, ["checkout", "-b", "feature"]);
    renameSync(
      join(repo, "migrations/0107_old_top.sql"),
      join(repo, "migrations/0107_old_top_renamed.sql"),
    );
    gitOrThrow(repo, ["add", "-A"]);
    gitOrThrow(repo, ["commit", "-m", "rename migration"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.added).toEqual(["migrations/0107_old_top_renamed.sql"]);
    expect(result.offenders).toHaveLength(1);
    expect(result.offenders[0].file).toBe("migrations/0107_old_top_renamed.sql");
  });

  it("fails when a base migration is renamed onto a strictly higher number", () => {
    // The #3875 hole: under --no-renames the rename shows as D+A and the added
    // 0200 sorts above the base top, so the numbering check alone passes it —
    // but 0088 already exists on the base branch and may be applied to
    // production, where the d1_migrations ledger keys it by filename.
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    gitOrThrow(repo, ["checkout", "-b", "feature"]);
    renameSync(
      join(repo, "migrations/0088_recreate_delivery_hot_path_indexes.sql"),
      join(repo, "migrations/0200_recreate_delivery_hot_path_indexes.sql"),
    );
    gitOrThrow(repo, ["add", "-A"]);
    gitOrThrow(repo, ["commit", "-m", "renumber migration"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.offenders).toHaveLength(1);
    expect(result.offenders[0].file).toBe(
      "migrations/0200_recreate_delivery_hot_path_indexes.sql",
    );
    expect(result.offenders[0].renamedFrom).toBe(
      "migrations/0088_recreate_delivery_hot_path_indexes.sql",
    );
    expect(formatOffenders(result)).toContain("renamed from");
  });

  it("fails when a base migration is renamed keeping its number, and reports the rename rather than the stale number", () => {
    // Same-number renames were already caught by the A-side check (the added
    // path still carries a number <= baseTop); the rename pass keeps the
    // verdict but names the real offence — re-keying the applied ledger.
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
      "migrations/0107_website_site_scan_crawl_count.sql": "SELECT 1;",
    });
    gitOrThrow(repo, ["checkout", "-b", "feature"]);
    renameSync(
      join(repo, "migrations/0088_recreate_delivery_hot_path_indexes.sql"),
      join(repo, "migrations/0088_org_scoped_ownership.sql"),
    );
    gitOrThrow(repo, ["add", "-A"]);
    gitOrThrow(repo, ["commit", "-m", "rename migration same number"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.offenders).toHaveLength(1);
    expect(result.offenders[0].file).toBe("migrations/0088_org_scoped_ownership.sql");
    expect(result.offenders[0].renamedFrom).toBe(
      "migrations/0088_recreate_delivery_hot_path_indexes.sql",
    );
  });

  it("fails when a base migration is moved out of migrations/", () => {
    // The rename pass is unscoped on the target side: moving an applied
    // migration out of the directory removes a filename the production ledger
    // recorded, which fails the deploy's apply step.
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    gitOrThrow(repo, ["checkout", "-b", "feature"]);
    mkdirSync(join(repo, "archive"), { recursive: true });
    renameSync(
      join(repo, "migrations/0088_recreate_delivery_hot_path_indexes.sql"),
      join(repo, "archive/0088_recreate_delivery_hot_path_indexes.sql"),
    );
    gitOrThrow(repo, ["add", "-A"]);
    gitOrThrow(repo, ["commit", "-m", "move migration out"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.offenders).toHaveLength(1);
    expect(result.offenders[0].renamedFrom).toBe(
      "migrations/0088_recreate_delivery_hot_path_indexes.sql",
    );
  });

  it("treats a file moved into migrations/ as a new migration, not a rename offence", () => {
    // Source is not a migration on the base branch, so there is no ledger
    // entry to re-key — the file is checked by numbering like any add.
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
      "docs/0090_draft.sql": "SELECT 1;",
    });
    gitOrThrow(repo, ["checkout", "-b", "feature"]);
    renameSync(
      join(repo, "docs/0090_draft.sql"),
      join(repo, "migrations/0090_draft.sql"),
    );
    gitOrThrow(repo, ["add", "-A"]);
    gitOrThrow(repo, ["commit", "-m", "move draft into migrations"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.added).toEqual(["migrations/0090_draft.sql"]);
    expect(result.offenders).toEqual([]);
  });

  it("fails when an added .sql file does not match the numbering rule", () => {
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    addOnPr(repo, ["migrations/0099a_unnumbered.sql"]);
    const result = checkMigrationNumbering(repo, "main", "HEAD");
    expect(result.offenders).toHaveLength(1);
    expect(result.offenders[0].file).toBe("migrations/0099a_unnumbered.sql");
    expect(result.offenders[0].number).toBeNull();
    expect(formatOffenders(result)).toContain("numbering rule");
  });

  it("fails closed when the base ref cannot be resolved", () => {
    const repo = setupRepo({
      "migrations/0088_top.sql": "SELECT 1;",
    });
    expect(() => checkMigrationNumbering(repo, "no-such-ref", "HEAD")).toThrow();
  });
});
