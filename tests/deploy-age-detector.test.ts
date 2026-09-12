import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");
const scriptPath = resolve(repoRoot, "scripts/deploy-age.mjs");

function runDeployAge(env: Record<string, string>) {
  return spawnSync("node", [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
}

describe("deploy-age measure line (issue #3224 chain-level detector)", () => {
  // Issue #3224 — "deploy staleness must surface as a detector, not a
  // discarded observation." The deploy workflow runs
  // scripts/check-live-public-home.mjs as `live_public_truth`, but that
  // step only emits its verdict on a successful deploy execution. The
  // chain-level detector lives at the script level: scripts/deploy-age.mjs
  // runs on every deploy run (success AND failure) and emits the same
  // measure line. It now also probes the live site so a regression
  // between when the gate ran and when this script ran surfaces in the
  // emitted line — no new workflow, no new timer (gate-integrity
  // would block a new workflow from this worker; a script-level
  // extension runs on every existing deploy and is the smaller fix).

  it("emits a live_edge_cache token on every measure line, never throws", () => {
    // PUBLIC_HOME_URL set to the deterministic sentinel keeps the probe
    // out of the live prod path; the script must still emit a well-
    // shaped line with live_edge_cache=skipped.
    const result = runDeployAge({ PUBLIC_HOME_URL: "" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(
      /^deploy: last_success_age_h=\S+ merges_since=\S+ last_failure=\S+ live_edge_cache=skipped$/u,
    );
  });

  it("folds probe network failures into live_edge_cache=UNREACHABLE, never crashes", () => {
    // Point the probe at an unroutable host so the fetch errors on DNS /
    // connection — same shape as the live cluster being down, the host
    // being firewalled, or the budget exhausted.
    // 203.0.113.1 is reserved for documentation (RFC 5737); nothing
    // routes there, so the probe returns connection failure quickly.
    const result = runDeployAge({
      PUBLIC_HOME_URL: "http://203.0.113.1:1/",
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(
      /^deploy: last_success_age_h=\S+ merges_since=\S+ last_failure=\S+ live_edge_cache=UNREACHABLE$/u,
    );
  });

  it("emits a parseable measure line even when the Actions API path is offline", () => {
    // No token, no API access — the script falls back to
    // deploy-ledger.jsonl in HEAD. Whatever the last-success row says,
    // the line shape must hold; live_edge_cache is appended last and
    // never breaks the parser.
    const result = runDeployAge({ GH_TOKEN: "", GITHUB_TOKEN: "" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(
      /^deploy: last_success_age_h=\S+ merges_since=\S+ last_failure=\S+ live_edge_cache=(HIT|MISS|UNREACHABLE|skipped)$/u,
    );
  });

  it("uses an AbortSignal-bounded probe so the deploy step never hangs the measure", () => {
    // White-box: the script must bound each fetch with AbortSignal.timeout
    // so a hung deploy step can never silently stretch to the 270-minute
    // job cap. Read the source and pin the literal call shape — any
    // future "let's drop the timeout" edit breaks this test.
    const source = require("node:fs").readFileSync(scriptPath, "utf8");
    expect(source).toContain("AbortSignal.timeout(10_000)");
    // And the probe function must wrap the two GETs so the worst case is
    // bounded (~25s), not unbounded.
    expect(source).toMatch(/async function probeLiveEdgeCache\(/);
    expect(source).toContain("await head(\"/\")");
    // The verdict string is exposed so a measure-line parser never has to
    // guess: HIT, MISS, UNREACHABLE, skipped.
    expect(source).toContain("\"HIT\"");
    expect(source).toContain("\"MISS\"");
    expect(source).toContain("\"UNREACHABLE\"");
    expect(source).toContain("\"skipped\"");
  });
});
