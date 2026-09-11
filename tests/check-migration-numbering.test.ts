import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../scripts/check-migration-numbering.mjs",
);

let mainRepo: string;
let workPrefixes: string[] = [];

/** Commit the given migration files onto a branch and return the repo dir. */
function setupRepo(migrations: Record<string, string>) {
  const repo = mkdtempSync(join(tmpdir(), "mig-numbering-"));
  workPrefixes.push(repo);
  const run = (args: string[], cwd = repo) =>
    spawnSync("git", args, { cwd, encoding: "utf8" });
  run(["init", "--initial-branch", "main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  run(["config", "commit.gpgsign", "false"]);
  for (const [file, content] of Object.entries(migrations)) {
    const full = join(repo, file);
    mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    writeFileSync(full, content);
  }
  run(["add", "."]);
  run(["commit", "-m", "base"]);
  return repo;
}

function runCheck(repo: string, head: string | null) {
  if (head) {
    spawnSync("git", ["checkout", "-b", "feature"], { cwd: repo, encoding: "utf8" });
    const run = (args: string[]) =>
      spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    run(["add", "."]);
    run(["commit", "-m", "added migration"]);
  }
  return spawnSync("node", [scriptPath], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      CHECK_MIGRATION_NUMBERING_BASE_REF: "main",
      CHECK_MIGRATION_NUMBERING_HEAD: "HEAD",
    },
  });
}

beforeAll(() => {
  mainRepo = setupRepo({
    "migrations/0087_cta_pipeline_bail_reason_counts.sql": "SELECT 1;",
    "migrations/0087_signup_source_open_allowlist.sql": "SELECT 1;",
    "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
  });
});

afterAll(() => {
  for (const dir of workPrefixes) rmSync(dir, { recursive: true, force: true });
});

describe("scripts/check-migration-numbering.mjs", () => {
  it("passes when a PR touching no migrations runs on clean main (termination bullet, exit 0)", () => {
    // No feature branch, no new file: HEAD == base.
    const result = runCheck(mainRepo, null);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("migration_numbering_ok");
  });

  it("passes when the added migration sorts strictly above the base top", () => {
    writeFileSync(join(mainRepo, "migrations/0089_org_scoped_ownership.sql"), "SELECT 1;");
    const result = runCheck(mainRepo, "HEAD");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("migration_numbering_ok");
  });

  it("fails when the added migration duplicates the current top number, naming the file and the minimum", () => {
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    writeFileSync(join(repo, "migrations/0088_org_scoped_ownership.sql"), "SELECT 1;");
    const result = runCheck(repo, "HEAD");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("migrations/0088_org_scoped_ownership.sql");
    expect(result.stderr).toContain("required minimum: 89");
  });

  it("fails when the added migration number is below the base top", () => {
    const repo = setupRepo({
      "migrations/0088_recreate_delivery_hot_path_indexes.sql": "SELECT 1;",
    });
    writeFileSync(join(repo, "migrations/0001_dupe.sql"), "SELECT 1;");
    const result = runCheck(repo, "HEAD");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("migrations/0001_dupe.sql");
    expect(result.stderr).toContain("required minimum: 89");
  });

  it("does not trip on historical duplicate numbers already on the base branch", () => {
    // Base already carries two 0087_* files (see beforeAll). An added migration
    // above BOTH must pass even though the base is not globally unique.
    writeFileSync(join(mainRepo, "migrations/0090_event_type_free_text.sql"), "SELECT 1;");
    const result = runCheck(mainRepo, "HEAD");
    expect(result.status, result.stderr).toBe(0);
  });

  it("fails closed when the base ref cannot be resolved", () => {
    const repo = setupRepo({ "migrations/0088_top.sql": "SELECT 1;" });
    const result = spawnSync("node", [scriptPath], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        CHECK_MIGRATION_NUMBERING_BASE_REF: "no-such-ref",
        CHECK_MIGRATION_NUMBERING_HEAD: "HEAD",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("FAIL");
  });
});
