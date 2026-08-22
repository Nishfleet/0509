import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { isolatedGitEnv } from "./helpers/git-env";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/customer-readiness-candidate.mjs");
const repos: string[] = [];
function git(repo: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: isolatedGitEnv(),
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function createRepo(mode = "v2") {
  const repo = mkdtempSync(join(tmpdir(), "0509-customer-readiness-candidate-"));
  repos.push(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "candidate-test@example.com"]);
  git(repo, ["config", "user.name", "Candidate Test"]);
  writeWrangler(repo, mode);
  writeFileSync(join(repo, "tracked.txt"), "base\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "initial"]);
  return repo;
}

function writeWrangler(repo: string, mode: string) {
  writeFileSync(
    join(repo, "wrangler.jsonc"),
    `{
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "0509",
          "database_id": "746c6e3d-782e-443a-82d6-28ca93a16294"
        }
      ],
      "vars": {
        "SEARCH_ROLLOUT_MODE": "${mode}"
      }
    }
    // release-candidate test config
    `,
  );
}

function runCandidate(
  repo: string,
  args: string[] = ["--base", "HEAD"],
  extraEnv: Record<string, string | undefined> = {},
) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: isolatedGitEnv({ ...process.env, ...extraEnv }),
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = result.stdout.trim();
  return {
    code: result.status,
    output,
    report: output ? (JSON.parse(output) as Record<string, any>) : null,
  };
}

afterEach(() => {
  while (repos.length > 0) {
    rmSync(repos.pop()!, { recursive: true, force: true });
  }
});

describe("customer readiness candidate identity", () => {
  it("stays inside the temporary repository under a contaminated Git environment", () => {
    const repo = createRepo();
    const result = runCandidate(repo, ["--base", "HEAD"], {
      GIT_DIR: "/tmp/not-the-candidate.git",
      GIT_WORK_TREE: "/tmp/not-the-candidate-worktree",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.bare",
      GIT_CONFIG_VALUE_0: "true",
      GIT_SHALLOW_FILE: "/tmp/not-the-candidate-shallow",
      GIT_REPLACE_REF_BASE: "refs/replace/hostile",
    });

    expect(result.code).toBe(0);
    expect(result.report).toMatchObject({ ok: true, branch: "main" });
    expect(git(repo, ["config", "--bool", "core.bare"])).toBe("false");
  });

  it("classifies a detached exact remote-main commit as protected main", () => {
    const repo = createRepo();
    const head = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["update-ref", "refs/remotes/origin/main", head]);
    git(repo, ["switch", "--detach", "-q", head]);

    const result = runCandidate(repo);

    expect(result.code).toBe(0);
    expect(result.report).toMatchObject({
      ok: true,
      branch: "main",
      baseCommit: head,
      headCommit: head,
    });
  });

  it("fails closed for missing, mismatched, or malformed detached remote-main identity", () => {
    const missingRepo = createRepo();
    const missingHead = git(missingRepo, ["rev-parse", "HEAD"]);
    git(missingRepo, ["switch", "--detach", "-q", missingHead]);
    expect(runCandidate(missingRepo).report).toMatchObject({
      branch: "detached",
      headCommit: missingHead,
    });

    const mismatchedRepo = createRepo();
    const remoteMain = git(mismatchedRepo, ["rev-parse", "HEAD"]);
    writeFileSync(join(mismatchedRepo, "tracked.txt"), "new detached commit\n");
    git(mismatchedRepo, ["add", "tracked.txt"]);
    git(mismatchedRepo, ["commit", "-q", "-m", "detached candidate"]);
    const mismatchedHead = git(mismatchedRepo, ["rev-parse", "HEAD"]);
    git(mismatchedRepo, ["update-ref", "refs/remotes/origin/main", remoteMain]);
    git(mismatchedRepo, ["switch", "--detach", "-q", mismatchedHead]);
    expect(runCandidate(mismatchedRepo).report).toMatchObject({
      branch: "detached",
      headCommit: mismatchedHead,
    });

    const malformedRepo = createRepo();
    const malformedHead = git(malformedRepo, ["rev-parse", "HEAD"]);
    const blobPath = join(malformedRepo, "remote-main-blob.txt");
    writeFileSync(blobPath, "not a commit\n");
    const blob = git(malformedRepo, ["hash-object", "-w", blobPath]);
    rmSync(blobPath);
    git(malformedRepo, ["update-ref", "refs/remotes/origin/main", blob]);
    git(malformedRepo, ["switch", "--detach", "-q", malformedHead]);
    expect(runCandidate(malformedRepo).report).toMatchObject({
      branch: "detached",
      headCommit: malformedHead,
    });
  });

  it("keeps a symbolic non-main branch unprotected even at the remote-main commit", () => {
    const repo = createRepo();
    const head = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["update-ref", "refs/remotes/origin/main", head]);
    git(repo, ["switch", "-q", "-c", "codex/not-main"]);

    const result = runCandidate(repo);

    expect(result.code).toBe(0);
    expect(result.report).toMatchObject({
      branch: "codex/not-main",
      headCommit: head,
    });
  });

  it("binds the effective source tree rather than branch, base, or commit metadata", () => {
    const repo = createRepo();
    writeFileSync(join(repo, "tracked.txt"), "candidate body\n");
    writeFileSync(join(repo, "untracked.txt"), "candidate addition\n");
    const dirty = runCandidate(repo, ["--base", "HEAD"]);
    expect(dirty.code).toBe(0);

    git(repo, ["switch", "-q", "-c", "codex/release-candidate"]);
    const renamedBranch = runCandidate(repo, ["--base", "HEAD"]);
    expect(renamedBranch.report?.fingerprint).toBe(dirty.report?.fingerprint);

    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "candidate"]);
    const committed = runCandidate(repo, ["--base", "HEAD"]);
    expect(committed.report?.fingerprint).toBe(dirty.report?.fingerprint);
    expect(committed.report?.sourceTree).toMatchObject({
      files: 3,
      sha256: dirty.report?.fingerprint,
    });
  });

  it("is deterministic and reflects tracked, staged, unstaged, and untracked state without printing contents", () => {
    const repo = createRepo();
    const base = git(repo, ["rev-parse", "HEAD"]);
    const clean = runCandidate(repo, ["--base", base]);
    const cleanAgain = runCandidate(repo, ["--base", base]);
    expect(clean.code).toBe(0);
    expect(cleanAgain.report?.fingerprint).toBe(clean.report?.fingerprint);
    expect(clean.report?.status).toMatchObject({ staged: 0, unstaged: 0, untracked: 0, hasChanges: false });

    writeFileSync(join(repo, "tracked.txt"), "staged secret candidate\n");
    writeFileSync(join(repo, "untracked-secret.txt"), "super-secret-value");
    git(repo, ["add", "tracked.txt"]);
    const staged = runCandidate(repo, ["--base", base]);
    expect(staged.report?.status).toMatchObject({ staged: 1, unstaged: 0, untracked: 1, hasChanges: true });
    expect(staged.report?.untracked).toMatchObject({ count: 1 });
    expect(staged.output).not.toContain("untracked-secret.txt");
    expect(staged.output).not.toContain("super-secret-value");

    git(repo, ["reset", "-q", "HEAD", "tracked.txt"]);
    const unstaged = runCandidate(repo, ["--base", base]);
    expect(unstaged.report?.status).toMatchObject({ staged: 0, unstaged: 1, untracked: 1, hasChanges: true });
    expect(unstaged.report?.fingerprint).toBe(staged.report?.fingerprint);

    writeFileSync(join(repo, "tracked.txt"), "drifted candidate\n");
    const drifted = runCandidate(repo, ["--base", base, "--expect-fingerprint", staged.report?.fingerprint]);
    expect(drifted.code).not.toBe(0);
    expect(drifted.report?.blockers).toContain("candidate_fingerprint_mismatch");
    expect(drifted.output).not.toContain("drifted candidate");

    writeFileSync(join(repo, "untracked-secret.txt"), "another-secret-v");
    const sameLengthUntrackedDrift = runCandidate(repo, ["--base", base]);
    expect(sameLengthUntrackedDrift.report?.fingerprint).not.toBe(unstaged.report?.fingerprint);
  });

  it("excludes ignored files while refusing symlink and special untracked entries", () => {
    const repo = createRepo();
    const base = git(repo, ["rev-parse", "HEAD"]);
    writeFileSync(join(repo, ".gitignore"), "ignored-secret.txt\n");
    git(repo, ["add", ".gitignore"]);
    git(repo, ["commit", "-q", "-m", "ignore"]);
    const beforeIgnored = runCandidate(repo, ["--base", base]);
    writeFileSync(join(repo, "ignored-secret.txt"), "ignored-secret-value");
    const afterIgnored = runCandidate(repo, ["--base", base]);
    expect(afterIgnored.report?.fingerprint).toBe(beforeIgnored.report?.fingerprint);
    expect(afterIgnored.report?.untracked.count).toBe(0);

    symlinkSync("tracked.txt", join(repo, "candidate-secret-link"));
    const refusedSymlink = runCandidate(repo, ["--base", base]);
    expect(refusedSymlink.code).not.toBe(0);
    expect(refusedSymlink.output).not.toContain("candidate-secret-link");
    expect(refusedSymlink.output).not.toContain(repo);

    if (process.platform !== "win32") {
      execFileSync("mkfifo", [join(repo, "candidate-secret-fifo")]);
      const refusedFifo = runCandidate(repo, ["--base", base]);
      expect(refusedFifo.code).not.toBe(0);
      expect(refusedFifo.output).not.toContain("candidate-secret-fifo");
      expect(refusedFifo.output).not.toContain(repo);
    }
  });

  it("requires committed v2 rollout mode and reports only safe identity evidence", () => {
    const repo = createRepo("legacy-secret-\\u007f");
    const refused = runCandidate(repo);
    expect(refused.code).not.toBe(0);
    expect(refused.report).toMatchObject({
      ok: false,
      blockers: ["search_rollout_mode_not_v2"],
      wrangler: { searchRolloutMode: "non_v2_or_missing" },
    });
    expect(refused.output).not.toContain("legacy-secret");

    const v2Repo = createRepo();
    writeWrangler(v2Repo, "legacy-secret-\\u007f");
    const refusedWorktreeMode = runCandidate(v2Repo);
    expect(refusedWorktreeMode.code).not.toBe(0);
    expect(refusedWorktreeMode.report).toMatchObject({
      ok: false,
      blockers: ["search_rollout_mode_not_v2"],
      wrangler: {
        searchRolloutMode: "v2",
        worktreeSearchRolloutMode: "non_v2_or_missing",
      },
    });
    expect(refusedWorktreeMode.output).not.toContain("legacy-secret");

    writeWrangler(v2Repo, "v2");
    const noEvidence = runCandidate(v2Repo);
    expect(noEvidence.report?.wrangler).toMatchObject({
      d1Database: {
        binding: "DB",
        name: "0509",
        uuid: "746c6e3d-782e-443a-82d6-28ca93a16294",
      },
      worktreeD1Database: {
        binding: "DB",
        name: "0509",
        uuid: "746c6e3d-782e-443a-82d6-28ca93a16294",
      },
    });
    expect(noEvidence.report?.deployedIdentity).toMatchObject({
      classification: "external_proof_required",
      evidenceProvided: false,
    });
    const explicit = runCandidate(v2Repo, [
      "--base",
      "HEAD",
      "--deployed-version",
      "release-2026-07-15",
      "--deployed-config-fingerprint",
      "0".repeat(64),
    ]);
    expect(explicit.code).toBe(0);
    expect(explicit.report?.deployedIdentity).toMatchObject({
      classification: "explicit_evidence",
      evidenceProvided: true,
      versionProvided: true,
      configFingerprintProvided: true,
      configFingerprint: "0".repeat(64),
    });
    expect(explicit.output).not.toContain("release-2026-07-15");
  });
});

describe("runner-shaped detached candidate identity", () => {
  // Reproduces the deploy-production runner state from run 32528443333:
  // actions/checkout finds the pinned SHA already present, skips fetching,
  // and detaches HEAD exactly at the pinned (merged) candidate, while
  // refs/remotes/origin/main still points at a NEWER tip last fetched by an
  // unrelated workflow sharing the workspace.
  function createRunnerShapedRepo() {
    const repo = createRepo();
    const pinned = git(repo, ["rev-parse", "HEAD"]);
    writeFileSync(join(repo, "tracked.txt"), "newer main tip\n");
    git(repo, ["add", "tracked.txt"]);
    git(repo, ["commit", "-q", "-m", "newer main tip"]);
    git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(repo, ["remote", "add", "origin", "https://github.com/Nishfleet/0509.git"]);
    git(repo, ["switch", "--detach", "-q", pinned]);
    return { repo, pinned };
  }

  async function withCompareApi(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
    run: (apiUrl: string) => Promise<void> | void,
  ) {
    const server: Server = createServer(handler);
    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("compare_api_address_unavailable");
    try {
      await run(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    }
  }

  // Async twin of runCandidate: spawnSync would block this test process's
  // event loop, so the in-process compare-API stub could never accept the
  // spawned candidate's connection.
  function runCandidateAsync(
    repo: string,
    args: string[] = ["--base", "HEAD"],
    extraEnv: Record<string, string | undefined> = {},
  ): Promise<{ code: number | null; output: string; report: Record<string, any> | null }> {
    return new Promise((resolveRun, rejectRun) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        cwd: repo,
        env: isolatedGitEnv({ ...process.env, ...extraEnv }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.on("close", (code) => {
        const output = stdout.trim();
        resolveRun({ code, output, report: output ? (JSON.parse(output) as Record<string, any>) : null });
      });
      child.on("error", rejectRun);
    });
  }

  it("accepts a detached pinned candidate contained in protected main via a provider containment proof", async () => {
    const { repo, pinned } = createRunnerShapedRepo();
    let requestedPath = "";

    await withCompareApi(
      (req, res) => {
        requestedPath = req.url ?? "";
        expect(requestedPath).toMatch(/^\/repos\/Nishfleet\/0509\/compare\/[0-9a-f]{40}\.\.\.main$/u);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ status: "ahead", ahead_by: 15, behind_by: 0, base_commit: { sha: pinned } }));
      },
      async (apiUrl) => {
        const result = await runCandidateAsync(repo, ["--base", "HEAD"], { GITHUB_API_URL: apiUrl });

        expect(result.code).toBe(0);
        expect(result.report).toMatchObject({ ok: true, branch: "main", headCommit: pinned });
        expect(result.report?.branchProof).toMatchObject({
          proved: true,
          source: "provider_compare",
          repository: "Nishfleet/0509",
          status: "ahead",
        });
        expect(requestedPath).toContain(`/${pinned}...main`);
      },
    );
  });

  it("still rejects a genuinely off-main detached candidate even when the local ref exists", async () => {
    const { repo } = createRunnerShapedRepo();
    writeFileSync(join(repo, "tracked.txt"), "off-main candidate\n");
    git(repo, ["commit", "-qam", "off-main candidate"]);
    const offMain = git(repo, ["rev-parse", "HEAD"]);

    await withCompareApi(
      (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ status: "diverged", ahead_by: 1, behind_by: 2 }));
      },
      async (apiUrl) => {
        const result = await runCandidateAsync(repo, ["--base", "HEAD"], { GITHUB_API_URL: apiUrl });

        expect(result.report).toMatchObject({
          branch: "detached",
          headCommit: offMain,
        });
        expect(result.report?.branchProof).toMatchObject({ proved: false, status: "diverged" });
      },
    );
  });

  it("fails closed for a detached candidate when the provider containment proof is unavailable", async () => {
    const { repo } = createRunnerShapedRepo();

    await withCompareApi(
      (_req, res) => {
        res.statusCode = 500;
        res.end("{}");
      },
      async (apiUrl) => {
        const result = await runCandidateAsync(repo, ["--base", "HEAD"], { GITHUB_API_URL: apiUrl });
        expect(result.report).toMatchObject({ branch: "detached" });
        expect(result.report?.branchProof).toMatchObject({ proved: false, reason: "provider_compare_http_500" });
      },
    );

    const unreachable = await runCandidateAsync(repo, ["--base", "HEAD"], {
      GITHUB_API_URL: "http://127.0.0.1:9",
    });
    expect(unreachable.report).toMatchObject({ branch: "detached" });
    expect(unreachable.report?.branchProof).toMatchObject({ proved: false, reason: "provider_compare_unavailable" });
  });
});
