import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// 2026-10-02 used 1,113,645 Workers AI neurons (about $12 over the free line)
// because evals.yml had no ceiling (0509#7249).
const workflow = readFileSync(path.resolve(import.meta.dirname, "../.github/workflows/evals.yml"), "utf8");

describe("evals.yml neuron budget", () => {
  it("states a numeric daily budget", () => {
    expect(workflow).toMatch(/^\s+EVAL_NEURON_BUDGET: "\d+"$/m);
  });

  it("checks the budget before the eval step runs", () => {
    const guard = workflow.indexOf("Refuse past the daily neuron budget");
    const run = workflow.indexOf("npm run eval");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(run);
    expect(workflow).toContain('"$used" -ge "$EVAL_NEURON_BUDGET"');
  });

  it("keeps the token out of curl's argv", () => {
    expect(workflow).not.toMatch(/-H "Authorization: Bearer \$/);
    expect(workflow).toContain("--config <(printf");
  });

  it("prints the neuron cost after the run, even when the run fails", () => {
    const after = workflow.slice(workflow.indexOf("Print the neuron cost"));
    expect(after).toContain("if: always()");
    expect(after).toContain("aiInferenceAdaptiveGroups");
  });
});
