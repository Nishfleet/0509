import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { assessDeployChain } from "../scripts/verify-deploy-chain-progress.mjs";

// Fixture runs are newest-first, matching the Actions API ordering.
type RunFixture = {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  head_sha: string;
  jobs_started: number | null;
};

let seq = 0;
function run(partial: Partial<RunFixture>): RunFixture {
  seq += 1;
  return {
    id: 3_000_000 + seq,
    status: "completed",
    conclusion: "success",
    created_at: `2026-09-12T00:${String(seq).padStart(2, "0")}:00Z`,
    head_sha: "a".repeat(40),
    jobs_started: null,
    ...partial,
  };
}

function superseded(): RunFixture {
  // A pending deploy cancelled by a newer push before it ever started a
  // job — the intended deploy-latest supersession, never a breach.
  return run({ conclusion: "cancelled", jobs_started: 0 });
}

describe("deploy chain progress assessor (0509#2975)", () => {
  it("fails before: a cancelled run that had started jobs is a mid-flight kill", () => {
    // The pre-fix world the reopened issue feared: a deploy killed while
    // running, indistinguishable from benign supersessions without this
    // check.
    const result = assessDeployChain([
      run({ status: "in_progress", conclusion: null }),
      superseded(),
      run({ conclusion: "cancelled", jobs_started: 4 }),
      run({ conclusion: "failure" }),
    ]);
    expect(result.verdict).toBe("breach");
    expect(result.midflightKills).toHaveLength(1);
    expect(result.issues[0]).toContain("midflight_kill");
  });

  it("passes after: a push burst supersedes pendings and a green deploy still lands", () => {
    // Back-to-back pushes during a deploy: queued candidates are
    // superseded (cancelled, zero jobs), the running deploy completes,
    // and the newest candidate lands green.
    const result = assessDeployChain([
      run({ conclusion: "success" }),
      superseded(),
      superseded(),
      superseded(),
      run({ conclusion: "failure" }),
      superseded(),
      run({ conclusion: "success" }),
    ]);
    expect(result.verdict).toBe("ok");
    expect(result.supersededPending).toBe(4);
    expect(result.midflightKills).toHaveLength(0);
    expect(result.lastTerminal?.conclusion).toBe("success");
  });

  it("stays ok while the newest candidate is still running", () => {
    const result = assessDeployChain([
      run({ status: "in_progress", conclusion: null }),
      superseded(),
      superseded(),
      run({ conclusion: "failure" }),
    ]);
    expect(result.verdict).toBe("ok");
    expect(result.live).toBe(1);
  });

  it("breaches when the chain is starved: newest run cancelled, nothing live", () => {
    // The tip of main has no deploy attempting it and nothing queued —
    // merges landed but the chain stopped.
    const result = assessDeployChain([
      superseded(),
      superseded(),
      run({ conclusion: "failure" }),
    ]);
    expect(result.verdict).toBe("breach");
    expect(result.issues[0]).toContain("starved");
  });

  it("breaches when every run in the window was cancelled", () => {
    const result = assessDeployChain([superseded(), superseded(), superseded()]);
    expect(result.verdict).toBe("breach");
  });

  it("an empty window is not a breach", () => {
    const result = assessDeployChain([]);
    expect(result.verdict).toBe("ok");
    expect(result.runs).toBe(0);
  });
});

describe("deploy-production wiring", () => {
  it("emits the deploy_chain verdict line on every run, after deploy-age, never fatal", () => {
    const parsed = parse(
      readFileSync(join(".github/workflows", "deploy-production.yml"), "utf8"),
    ) as {
      jobs: Record<
        string,
        { steps?: Array<{ name?: string; if?: string; run?: string }> }
      >;
    };
    const steps = parsed.jobs.deploy.steps ?? [];
    const index = (name: string) =>
      steps.findIndex((step) => step.name === name);
    const chainIndex = index("Emit deploy-chain progress line");
    expect(chainIndex).toBeGreaterThan(index("Emit deploy-age measure line"));
    const step = steps[chainIndex];
    expect(step.if).toBe("always()");
    expect(step.run).toContain(
      "node scripts/verify-deploy-chain-progress.mjs",
    );
    // Detector, not gate (same contract as deploy-age): the verdict line is
    // the signal; failing the deploy over history it cannot change would
    // trip auto-revert on a good release.
    expect(step.run).toContain("|| true");
    expect(step.run).toContain("GITHUB_STEP_SUMMARY");
  });
});
