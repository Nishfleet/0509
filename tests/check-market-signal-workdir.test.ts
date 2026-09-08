import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..");
const scriptPath = join(repoRoot, "scripts", "check-market-signal-workdir.sh");

// Regression guard for issue #1953: the 2026-09-08 daily market-signal run
// failed at the clean-checkout gate because an UNTRACKED
// `tests/ad-aggression-page.render.test.tsx` sat at a path origin/main also
// adds — git refuses the HEAD -> origin/main fast-forward
// ("untracked working tree files would be overwritten by merge") and the run
// died with no report. This test proves the pre-flight detector
// (`npm run signal:market:workdir-check`) catches exactly that fixture, with
// throwaway git repos under the OS temp dir — no shared workdir touched.

const gitEnv = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@test.local",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@test.local",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(dir: string, args: string[], expectFail = false) {
  const result = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...gitEnv },
  });
  if (!expectFail && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  }
  return result;
}

function runScript(workdir: string) {
  return spawnSync("bash", [scriptPath, workdir], { encoding: "utf8" });
}

// Fixture: a workdir whose HEAD predates origin/main, where origin/main adds
// `tests/ad-aggression-page.render.test.tsx` — the 2026-09-08 shape.
function makeBehindFixture() {
  const root = mkdtempSync(join(tmpdir(), "workdir-check-"));
  cleanups.push(root);
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  git(root, ["init", "--bare", "-q", remote]);
  mkdirSync(work);
  git(work, ["init", "-q"]);
  git(work, ["config", "user.name", "t"]);
  git(work, ["config", "user.email", "t@test.local"]);
  git(work, ["remote", "add", "origin", remote]);
  writeFileSync(join(work, "base.txt"), "base\n");
  git(work, ["add", "base.txt"]);
  git(work, ["commit", "-qm", "c1"]);
  git(work, ["branch", "-M", "main"]);
  git(work, ["push", "-q", "-u", "origin", "main"]);
  return { root, remote, work };
}

// Adds the conflicting test file to origin/main, rewinds local HEAD behind it,
// then drops an untracked copy on disk. Mirrors today's blocker exactly.
function makeConflictingFixture(contentOnRef: string, contentOnDisk: string) {
  const { remote, work } = makeBehindFixture();
  mkdirSync(join(work, "tests"), { recursive: true });
  writeFileSync(join(work, "tests", "ad-aggression-page.render.test.tsx"), contentOnRef);
  git(work, ["add", "tests/ad-aggression-page.render.test.tsx"]);
  git(work, ["commit", "-qm", "add conflicting test file"]);
  git(work, ["push", "-q", "origin", "main"]);
  git(work, ["reset", "--hard", "-q", "HEAD~1"]);
  mkdirSync(join(work, "tests"), { recursive: true });
  writeFileSync(join(work, "tests", "ad-aggression-page.render.test.tsx"), contentOnDisk);
  return { remote, work };
}

describe("check-market-signal-workdir (issue #1953 regression guard)", () => {
  it("flags today's exact blocker: untracked file conflicting with origin/main content", () => {
    const { work } = makeConflictingFixture(
      "const A = 1;\n".repeat(20),
      "const A = 999;\n".repeat(20),
    );

    const result = runScript(work);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("BLOCKER");
    expect(result.stdout).toContain("tests/ad-aggression-page.render.test.tsx");
    expect(result.stdout).toContain("conflicts with origin/main");
    // git itself must refuse the fast-forward — the failure mode from 2026-09-08.
    const ff = git(work, ["merge", "--ff-only", "origin/main"], true);
    expect(ff.status).not.toBe(0);
    expect(ff.stderr).toContain("would be overwritten");
  });

  it("flags an untracked file at a ref path even when content matches (git still refuses)", () => {
    const content = "same\n".repeat(5);
    const { work } = makeConflictingFixture(content, content);

    const result = runScript(work);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("BLOCKER");
    expect(result.stdout).toContain("tests/ad-aggression-page.render.test.tsx");
    expect(result.stdout).toContain("still blocks the fast-forward");
  });

  it("flags an untracked file where origin/main now has a directory (tree at the path)", () => {
    const { work } = makeBehindFixture();
    // origin/main turns 'a' (absent from HEAD) into a directory; an untracked
    // FILE named 'a' on disk blocks the fast-forward — verified live.
    mkdirSync(join(work, "a"), { recursive: true });
    writeFileSync(join(work, "a", "f.txt"), "inner\n");
    git(work, ["add", "a"]);
    git(work, ["commit", "-qm", "a becomes a directory"]);
    git(work, ["push", "-q", "origin", "main"]);
    git(work, ["reset", "--hard", "-q", "HEAD~1"]);
    writeFileSync(join(work, "a"), "scratch\n");
    expect(git(work, ["status", "--porcelain"], false).stdout).toContain("?? a");

    const result = runScript(work);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("BLOCKER");
    expect(result.stdout).toContain("now has a directory");
  });

  it("passes a plain scratch file that is not on origin/main", () => {
    const { work } = makeBehindFixture();
    writeFileSync(join(work, "s1.html"), "<html>scratch</html>\n");

    const result = runScript(work);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK: no untracked-overwrite blocker");
  });

  it("passes a clean workdir", () => {
    const { work } = makeBehindFixture();

    const result = runScript(work);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK: no untracked-overwrite blocker");
  });

  it("exits 2 with a clear FATAL on a non-repo directory", () => {
    const root = mkdtempSync(join(tmpdir(), "workdir-check-"));
    cleanups.push(root);

    const result = runScript(root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a git work tree");
  });

  it("exits 2 with a clear FATAL when the fetch fails", () => {
    const root = mkdtempSync(join(tmpdir(), "workdir-check-"));
    cleanups.push(root);
    const work = join(root, "work");
    mkdirSync(work);
    git(work, ["init", "-q"]);
    git(work, ["config", "user.name", "t"]);
    git(work, ["config", "user.email", "t@test.local"]);
    writeFileSync(join(work, "base.txt"), "base\n");
    git(work, ["add", "base.txt"]);
    git(work, ["commit", "-qm", "c1"]);
    // no remote configured — the probe's fetch must fail as an operational
    // failure (exit 2), never as a blocker (exit 1).
    const result = runScript(work);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git fetch origin main failed");
  });

  it("is wired in package.json (signal:market:workdir-check)", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.["signal:market:workdir-check"]).toBe(
      "bash scripts/check-market-signal-workdir.sh",
    );
  });
});