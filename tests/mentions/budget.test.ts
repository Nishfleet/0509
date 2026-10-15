import { describe, expect, it } from "vitest";

import { RUN_BUDGET_MS, SOURCE_BUDGET_MS, SweepBudget, timed } from "../../workers/mentions/budget";

describe("sweep budget", () => {
  it("lets a fresh run sweep every source", () => {
    expect(new SweepBudget().reason("gdelt.doc")).toBeNull();
  });

  it("stops one slow source without stopping the others", () => {
    const budget = new SweepBudget();
    budget.spend("gdelt.doc", SOURCE_BUDGET_MS);
    expect(budget.reason("gdelt.doc")).toBe("source_budget");
    expect(budget.reason("hn.algolia")).toBeNull();
  });

  it("stops every source once the whole run is out of time", () => {
    const budget = new SweepBudget();
    budget.spend("hn.algolia", RUN_BUDGET_MS - 1);
    expect(budget.reason("youtube.channel_rss")).toBeNull();
    budget.spend(null, 1);
    expect(budget.reason("youtube.channel_rss")).toBe("run_budget");
  });

  it("names and counts what it cut, per source and reason", () => {
    const budget = new SweepBudget();
    budget.defer("gdelt.doc", "source_budget");
    budget.defer("gdelt.doc", "source_budget");
    budget.defer("hn.algolia", "run_budget");
    expect(budget.deferred()).toEqual([
      { source: "gdelt.doc", reason: "source_budget", targets: 2 },
      { source: "hn.algolia", reason: "run_budget", targets: 1 },
    ]);
  });

  it("stamps the time a target took on its outcome", async () => {
    const outcome = await timed(() => Promise.resolve({ items: 1, stored: 1, unjudged: 0, skipped: 0 }));
    expect(outcome.ms).toBeGreaterThanOrEqual(0);
    expect(outcome.stored).toBe(1);
  });
});
