import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { parse } from "yaml";

const scriptPath = "scripts/check-d1-snapshot-age.sh";
const monitorWorkflowPath = ".github/workflows/market-signal-snapshot-age.yml";
const snapshotWorkflowPath = ".github/workflows/market-signal-snapshot.yml";

let workDir: string;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function runScript(args: string[]) {
  return spawnSync("bash", [scriptPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, TELEMETRY_DEPLOY_KEY: "" },
  });
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "snapshot-age-"));
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("check-d1-snapshot-age.sh", () => {
  it("exits 0 and prints market_signal_snapshot_fresh when age < threshold", () => {
    const file = join(workDir, "fresh.json");
    writeFileSync(file, JSON.stringify({ generatedAt: iso(-2 * 3600_000) }) + "\n");
    const result = runScript(["--snapshot-file", file, "--max-age-hours", "24"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("market_signal_snapshot_fresh");
    expect(result.stdout).toContain("age=2.00h");
  });

  it("exits 1 and prints market_signal_snapshot_stale when age > threshold", () => {
    const file = join(workDir, "stale.json");
    writeFileSync(file, JSON.stringify({ generatedAt: iso(-30 * 3600_000) }) + "\n");
    const result = runScript(["--snapshot-file", file, "--max-age-hours", "24"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("market_signal_snapshot_stale");
    expect(result.stderr).toContain("threshold=24h");
  });

  it("fires the stale alert when the threshold is artificially set to 0 (verify bullet)", () => {
    // The issue's verify bullet: "Trigger the alert condition artificially and
    // verify it fires." A 0-hour threshold against a real (past) generatedAt
    // forces the stale path without a missing run.
    const file = join(workDir, "artificial.json");
    writeFileSync(file, JSON.stringify({ generatedAt: iso(-1 * 3600_000) }) + "\n");
    const result = runScript(["--snapshot-file", file, "--max-age-hours", "0"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("market_signal_snapshot_stale");
    expect(result.stderr).toContain("threshold=0h");
  });

  it("exits 1 when generatedAt is missing", () => {
    const file = join(workDir, "no-generated.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1 }) + "\n");
    const result = runScript(["--snapshot-file", file]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("market_signal_snapshot_invalid");
    expect(result.stderr).toContain("generatedAt missing");
  });

  it("exits 1 when the snapshot file is not valid JSON", () => {
    const file = join(workDir, "broken.json");
    writeFileSync(file, "not json at all\n");
    const result = runScript(["--snapshot-file", file]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("market_signal_snapshot_invalid");
    expect(result.stderr).toContain("not valid JSON");
  });

  it("exits 1 when generatedAt is in the future", () => {
    const file = join(workDir, "future.json");
    writeFileSync(file, JSON.stringify({ generatedAt: iso(60 * 60_000) }) + "\n");
    const result = runScript(["--snapshot-file", file]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("market_signal_snapshot_invalid");
    expect(result.stderr).toContain("in the future");
  });

  it("exits 1 when the --snapshot-file does not exist", () => {
    const result = runScript(["--snapshot-file", join(workDir, "absent.json")]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("market_signal_snapshot_missing");
  });

  it("accepts a generatedAt with a +00:00 offset instead of Z", () => {
    const file = join(workDir, "offset.json");
    const when = new Date(Date.now() - 3 * 3600_000);
    writeFileSync(file, JSON.stringify({ generatedAt: when.toISOString().replace("Z", "+00:00") }) + "\n");
    const result = runScript(["--snapshot-file", file, "--max-age-hours", "24"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("market_signal_snapshot_fresh");
    expect(result.stdout).toContain("age=3.00h");
  });
});

describe("market-signal-snapshot-age monitor workflow", () => {
  it("runs on a 6-hourly schedule and on dispatch with a max-age-hours input", () => {
    // Structural guard: the monitor must exist and be scheduled, so a missed
    // daily run is never silent. Reading the YAML keeps the test from drifting
    // if the cron changes.
    const parsed = parse(readFileSync(monitorWorkflowPath, "utf8")) as {
      on?: {
        workflow_dispatch?: { inputs?: Record<string, { default?: string }> };
        schedule?: Array<{ cron?: string }>;
      };
      permissions?: Record<string, string>;
      concurrency?: { group?: string };
    };
    expect(parsed.on?.schedule).toContainEqual({ cron: "0 5,11,17,23 * * *" });
    expect(parsed.on?.workflow_dispatch).toBeDefined();
    // YAML preserves the hyphenated input name as a string key.
    expect(parsed.on?.workflow_dispatch?.inputs?.["max-age-hours"]?.default).toBe("24");
    expect(parsed.permissions).toEqual({ contents: "read", issues: "write" });
    expect(parsed.concurrency?.group).toBe("market-signal-snapshot-age");
  });
});

describe("market-signal-snapshot.yml concurrency fix (#1894)", () => {
  it("does not share the production provider-mutations concurrency group", () => {
    // The root cause: the daily snapshot was cancelled by deploy churn because
    // it shared the 0509-production-provider-mutations group. It must have its
    // own group so a deploy never cancels a queued snapshot again.
    const parsed = parse(readFileSync(snapshotWorkflowPath, "utf8")) as {
      concurrency?: { group?: string; "cancel-in-progress"?: boolean };
    };
    expect(parsed.concurrency?.group).toBe("market-signal-snapshot");
    expect(parsed.concurrency?.group).not.toBe("0509-production-provider-mutations");
    expect(parsed.concurrency?.["cancel-in-progress"]).toBe(false);
  });
});
