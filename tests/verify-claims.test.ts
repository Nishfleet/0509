import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// BET 10 (issue #1278) — Reconciliation D: scripts/verify-claims.mjs is the
// mechanical claim auditor. It reads the rows table in
// docs/customer-claim-surface-registry.json, runs each row's verification
// command, and fails on any red row or broken reconciliation invariant.
// This test runs the script for real (same pattern as
// tests/design-system-ratchet.test.ts), so the gate ships in CI with `npm run
// test`.

const root = join(__dirname, "..");

function runScript(
  extraArgs: string[] = [],
  env: Record<string, string> = {},
) {
  return spawnSync(
    process.execPath,
    [join(root, "scripts", "verify-claims.mjs"), ...extraArgs],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
}

type RegistryRow = Record<string, unknown>;

describe("verify:claims (BET 10 claim audit)", () => {
  it("runs clean against the checked-in registry", () => {
    const result = runScript();
    expect(result.stderr).toBe("");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("verify:claims OK");
    expect(result.stdout).toMatch(/rows=\d+ claimed_ge_verified=\d+ open_follow_ups=\d+/);
  });

  it("fails when a row claims a state verification cannot confirm without a follow-up", () => {
    // A claim gap (claimed != verified) without a linked open issue must fail
    // the run — a gap is never closed silently.
    const dir = mkdtempSync(join(tmpdir(), "0539-verify-claims-"));
    try {
      const registry = JSON.parse(
        readFileSync(join(root, "docs/customer-claim-surface-registry.json"), "utf8"),
      ) as { rows: RegistryRow[] };
      const rows = registry.rows.map((row: RegistryRow) => ({ ...row }));
      rows[0] = { ...rows[0], claimed: true, verified: false, followUp: null };
      const mutated = { ...registry, rows };
      const path = join(dir, "registry.json");
      writeFileSync(path, JSON.stringify(mutated, null, 2));
      const result = runScript(["--registry", path]);
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stderr).toContain("no open followUp issue URL");
      expect(result.stdout).toContain("open_follow_ups=1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on an unknown registry shape (missing rows table)", () => {
    const dir = mkdtempSync(join(tmpdir(), "0539-verify-claims-"));
    try {
      const path = join(dir, "registry.json");
      writeFileSync(path, JSON.stringify({ claims: [] }, null, 2));
      const result = runScript(["--registry", path]);
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stderr).toContain("no rows array");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});