import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Structural guard for the sorts-last migration gate (issue #3875, follow-up
// to #2507). The gate itself lives in tests/check-migration-numbering.test.ts
// and is pinned as a named step inside the required `codex-node-checks` job
// because shard jobs 2-4 are not required contexts — without the step, the
// gate blocks a merge only when the file happens to be collected by shard 1.
// But a step is just YAML: deleting it fails nothing, and the gate would
// silently revert to a 1-in-4 shard lottery. This test pins the wiring: the
// step must exist, run unconditionally inside the required job, and target
// the gate file, which must exist on disk.

const GATE_FILE = "tests/check-migration-numbering.test.ts";

const parsed = parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
  jobs: Record<string, WorkflowJob>;
};

type WorkflowStep = {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  "continue-on-error"?: unknown;
};

type WorkflowJob = {
  if?: string;
  needs?: string | string[];
  steps?: WorkflowStep[];
};

const job = parsed.jobs["codex-node-checks"];
const steps = job.steps ?? [];
const gateStep = steps.find((step) => step.run?.includes(GATE_FILE));

describe("migration numbering gate stays wired in CI", () => {
  it("the required codex-node-checks job exists", () => {
    expect(
      job,
      "codex-node-checks is the required context that carries the gate step",
    ).toBeDefined();
  });

  it("a step in codex-node-checks runs the gate file", () => {
    expect(
      gateStep,
      `no step in codex-node-checks runs ${GATE_FILE} — the sorts-last ` +
        "migration gate would silently stop running in CI",
    ).toBeDefined();
    expect(gateStep?.name).toMatch(/migration numbering/i);
    expect(gateStep?.run).toContain("vitest run");
    expect(gateStep?.run).toContain("--project node");
  });

  it("the gate step is unconditional — a skippable or soft gate is a dead gate", () => {
    expect(
      gateStep?.if,
      "an `if:` on the gate step lets the numbering check conclude skipped",
    ).toBeUndefined();
    expect(gateStep?.["continue-on-error"]).toBeUndefined();
  });

  it("the gate step fails fast, ahead of the build and test shards", () => {
    const buildIndex = steps.findIndex((step) => step.name === "Build");
    expect(buildIndex).toBeGreaterThan(-1);
    expect(steps.indexOf(gateStep!)).toBeLessThan(buildIndex);
  });

  it("the gate file the step invokes exists", () => {
    expect(
      existsSync(GATE_FILE),
      `${GATE_FILE} is pinned into CI by name — renaming or deleting it ` +
        "must not leave the step running nothing",
    ).toBe(true);
  });
});
