import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it, beforeAll, afterAll } from "vitest";

const scriptPath = "scripts/dispatch-deploy-production.sh";
const placeholder = "a".repeat(40);
const realSha = "389c0e550e3e335c386c498ce59779868088a5b7";
const otherRealSha = "c24e9735d73499977d4faa79d03c47c3f2a89ee2";

let stubBinDir: string;

function runScript(args: string[], env?: Record<string, string>) {
  return spawnSync("bash", [scriptPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubBinDir}:${process.env.PATH}`,
      GIT_TERMINAL_PROMPT: "0",
      ...env,
    },
  });
}

function sourceAndCall(call: string) {
  return spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail; source "${scriptPath}"; ${call}`,
    ],
    { encoding: "utf8" },
  );
}

describe("dispatch-deploy-production.sh", () => {
  beforeAll(() => {
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);

    stubBinDir = mkdtempSync(join(tmpdir(), "dispatch-stub-"));
    const ghStub = [
      "#!/usr/bin/env bash",
      'log="${STUB_GH_LOG:-}"',
      'if [ -n "$log" ]; then printf \'%s\\n\' "$*" >> "$log"; fi',
      'if [ "$1" = "api" ]; then',
      '  if [ -n "${STUB_MAIN_SHA:-}" ]; then printf \'%s\\n\' "$STUB_MAIN_SHA"; exit 0; fi',
      "  exit 1",
      "fi",
      "exit 0",
    ].join("\n");
    writeFileSync(join(stubBinDir, "gh"), ghStub, { mode: 0o755 });
  });

  afterAll(() => {
    if (stubBinDir) rmSync(stubBinDir, { recursive: true, force: true });
  });

  it("never carries a literal placeholder SHA fallback", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).not.toContain(placeholder);
    expect(source).toContain("is_valid_candidate_sha");
  });

  it("accepts real 40-hex commit SHAs", () => {
    for (const sha of [realSha, otherRealSha]) {
      expect(sourceAndCall(`is_valid_candidate_sha "${sha}"`).status).toBe(0);
    }
  });

  it("rejects placeholder/sentinel and malformed SHAs", () => {
    const rejected = [
      placeholder,
      "0".repeat(40),
      "f".repeat(40),
      "1".repeat(40),
      "",
      "389c0e5",
      `${realSha.slice(0, 39)}A`,
      "zzzz",
      "$(git rev-parse HEAD)",
    ];
    for (const sha of rejected) {
      expect(sourceAndCall(`is_valid_candidate_sha '${sha}'`).status).not.toBe(0);
    }
  });

  it("resolves the live main tip and dispatches exactly that SHA", () => {
    const log = join(stubBinDir, "calls.log");
    const result = runScript(["--repo", "Nishfleet/0509"], {
      STUB_MAIN_SHA: realSha,
      STUB_GH_LOG: log,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(realSha);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    const run = calls.find((line) => line.includes("workflow"));
    expect(run).toBeDefined();
    expect(run).toContain("run deploy-production.yml");
    expect(run).toContain("--ref main");
    expect(run).toContain(`expected_sha=${realSha}`);
    expect(run).not.toContain(placeholder);
  });

  it("fails fast with a clear message when the main tip cannot be resolved", () => {
    const log = join(stubBinDir, "unresolved.log");
    const result = runScript(
      ["--repo", "Nishfleet/does-not-exist-lane1-test"],
      { STUB_MAIN_SHA: "", STUB_GH_LOG: log },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("could_not_resolve_main_tip");
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.every((line) => !line.includes("workflow"))).toBe(true);
  });

  it("refuses an explicit placeholder expected_sha instead of dispatching it", () => {
    const log = join(stubBinDir, "placeholder.log");
    const result = runScript(["--expected-sha", placeholder], {
      STUB_MAIN_SHA: realSha,
      STUB_GH_LOG: log,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid_expected_sha");
    let calls: string[] = [];
    try {
      calls = readFileSync(log, "utf8").trim().split("\n");
    } catch {
      calls = [];
    }
    expect(calls.every((line) => !line.includes("workflow"))).toBe(true);
  });

  it("dry-run prints the exact command without invoking workflow run", () => {
    const log = join(stubBinDir, "dry-run.log");
    const result = runScript(["--dry-run"], {
      STUB_MAIN_SHA: realSha,
      STUB_GH_LOG: log,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`expected_sha=${realSha}`);
    expect(result.stdout).toContain("backup_proof_status=required");
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.every((line) => line.startsWith("api "))).toBe(true);
  });

  it("validates backup-proof-status and deferred authorization against the gate", () => {
    const badStatus = runScript(["--dry-run", "--backup-proof-status", "optional"], {
      STUB_MAIN_SHA: realSha,
    });
    expect(badStatus.status).not.toBe(0);
    expect(badStatus.stderr).toContain("invalid_backup_proof_status");

    const badAuth = runScript(
      ["--dry-run", "--backup-proof-status", "deferred", "--deferred-backup-authorization", "nish-accepted-no-backup-proof:deadbeef"],
      { STUB_MAIN_SHA: realSha },
    );
    expect(badAuth.status).not.toBe(0);
    expect(badAuth.stderr).toContain("invalid_deferred_authorization");

    const goodAuth = runScript(
      [
        "--dry-run",
        "--backup-proof-status",
        "deferred",
        "--deferred-backup-authorization",
        `nish-accepted-no-backup-proof:${realSha}`,
      ],
      { STUB_MAIN_SHA: realSha },
    );
    expect(goodAuth.status).toBe(0);
    expect(goodAuth.stdout).toContain(`deferred_backup_authorization=nish-accepted-no-backup-proof:${realSha}`);
  });
});
