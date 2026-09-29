import { describe, expect, it } from "vitest";

import {
  takeBrowserEscalation,
  takeBrowserScreenshot,
  takeBrowserShareImage,
} from "../../../app/lib/site/browser-budget.server";

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

  it("allows four screenshots per brand per day, refuses the fifth, allows the next day, and draws from a counter independent of escalations (0509#5816)", async () => {
    const first = await takeBrowserScreenshot("ws-shot", "ent-shot", "2026-09-25");
    expect(first).toBe(true);
    const second = await takeBrowserScreenshot("ws-shot", "ent-shot", "2026-09-25");
    expect(second).toBe(true);
    const third = await takeBrowserScreenshot("ws-shot", "ent-shot", "2026-09-25");
    expect(third).toBe(true);
    const fourth = await takeBrowserScreenshot("ws-shot", "ent-shot", "2026-09-25");
    expect(fourth).toBe(true);
    const fifth = await takeBrowserScreenshot("ws-shot", "ent-shot", "2026-09-25");
    expect(fifth).toBe(false);

    const nextDay = await takeBrowserScreenshot("ws-shot", "ent-shot", "2026-09-26");
    expect(nextDay).toBe(true);

    const escFirst = await takeBrowserEscalation("ws-shot", "ent-shot", "2026-09-25");
    expect(escFirst).toBe(true);
    const escSecond = await takeBrowserEscalation("ws-shot", "ent-shot", "2026-09-25");
    expect(escSecond).toBe(true);
    const escThird = await takeBrowserEscalation("ws-shot", "ent-shot", "2026-09-25");
    expect(escThird).toBe(true);
    const escFourth = await takeBrowserEscalation("ws-shot", "ent-shot", "2026-09-25");
    expect(escFourth).toBe(true);
    const escFifth = await takeBrowserEscalation("ws-shot", "ent-shot", "2026-09-25");
    expect(escFifth).toBe(false);
  });

  it("allows ten share-image renders per workspace per day, refuses the eleventh, and allows again the next day (0509#5818)", async () => {
    for (let take = 1; take <= 10; take++) {
      expect(await takeBrowserShareImage("ws-share", "2026-09-25")).toBe(true);
    }
    expect(await takeBrowserShareImage("ws-share", "2026-09-25")).toBe(false);
    expect(await takeBrowserShareImage("ws-share", "2026-09-26")).toBe(true);
  });
});
