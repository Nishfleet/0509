import { describe, expect, it } from "vitest";

import { bySourceRoundRobin, RUN_BUDGET_MS, SweepBudget, timed } from "../../workers/mentions/budget";

const plan = (...pluginKeys: string[]): { pluginKey: string; query: string }[] =>
  pluginKeys.map((pluginKey, index) => ({ pluginKey, query: `${pluginKey} ${String(index)}` }));

describe("sweep budget", () => {
  it("lets the slowest source spend most of the run instead of a flat slice", () => {
    const budget = new SweepBudget();
    budget.spend(24 * 60_000);
    expect(budget.spent()).toBe(false);
  });

  it("stops every source once the whole run is out of time", () => {
    const budget = new SweepBudget();
    budget.spend(RUN_BUDGET_MS - 1);
    expect(budget.spent()).toBe(false);
    budget.spend(1);
    expect(budget.spent()).toBe(true);
  });

  it("names and counts what it cut, per source", () => {
    const budget = new SweepBudget();
    budget.defer("gdelt.doc");
    budget.defer("gdelt.doc");
    budget.defer("hn.algolia");
    expect(budget.deferred()).toEqual([
      { source: "gdelt.doc", targets: 2 },
      { source: "hn.algolia", targets: 1 },
    ]);
  });

  it("stamps the time a target took on its outcome", async () => {
    const outcome = await timed(() => Promise.resolve({ items: 1, stored: 1, unjudged: 0, skipped: 0 }));
    expect(outcome.ms).toBeGreaterThanOrEqual(0);
    expect(outcome.stored).toBe(1);
  });
});

describe("the order the sweep reads the plan in", () => {
  it("gives every source a turn before any source gets a second one", () => {
    const order = bySourceRoundRobin(plan("gdelt.doc", "gdelt.doc", "gdelt.doc", "hn.algolia", "hn.algolia"));
    expect(order.map((target) => target.pluginKey)).toEqual([
      "gdelt.doc",
      "hn.algolia",
      "gdelt.doc",
      "hn.algolia",
      "gdelt.doc",
    ]);
  });

  it("keeps the plan's own order inside one source", () => {
    const order = bySourceRoundRobin(plan("gdelt.doc", "gdelt.doc", "hn.algolia", "gdelt.doc"));
    expect(order.map((target) => target.query)).toEqual(["gdelt.doc 0", "hn.algolia 2", "gdelt.doc 1", "gdelt.doc 3"]);
  });

  it("gives the news source a turn in the first round, so no source takes two targets before it takes one", () => {
    const order = bySourceRoundRobin(plan("slow.one", "slow.one", "slow.one", "gdelt.doc"));
    expect(order[1]?.pluginKey).toBe("gdelt.doc");
  });

  it("leaves a single-source plan alone", () => {
    expect(bySourceRoundRobin(plan("gdelt.doc", "gdelt.doc"))).toEqual(plan("gdelt.doc", "gdelt.doc"));
  });
});
