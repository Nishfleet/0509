import { describe, expect, it } from "vitest";

import { takeBrowserEscalation } from "../../../app/lib/site/browser-budget.server";

describe("BrowserBudget (0509#5294)", () => {
  it("allows four browser escalations per workspace per brand per UTC day and refuses the fifth", async () => {
    const first = await takeBrowserEscalation("ws-budget", "ent-budget", "2026-09-25");
    expect(first).toBe(true);
    const second = await takeBrowserEscalation("ws-budget", "ent-budget", "2026-09-25");
    expect(second).toBe(true);
    const third = await takeBrowserEscalation("ws-budget", "ent-budget", "2026-09-25");
    expect(third).toBe(true);
    const fourth = await takeBrowserEscalation("ws-budget", "ent-budget", "2026-09-25");
    expect(fourth).toBe(true);
    const fifth = await takeBrowserEscalation("ws-budget", "ent-budget", "2026-09-25");
    expect(fifth).toBe(false);

    const nextDay = await takeBrowserEscalation("ws-budget", "ent-budget", "2026-09-26");
    expect(nextDay).toBe(true);

    const otherBrand = await takeBrowserEscalation("ws-budget", "ent-budget-2", "2026-09-25");
    expect(otherBrand).toBe(true);
  });
});
