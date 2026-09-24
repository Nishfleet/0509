import { describe, expect, it } from "vitest";

import { withinProbeLimit } from "../../../app/lib/identity/card.server";

describe("onboarding identity probe limit", () => {
  it("stops the eleventh probe in a minute for one user", async () => {
    const results = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      results.push(await withinProbeLimit("probe-user-a"));
    }
    expect(results.slice(0, 10)).toEqual([true, true, true, true, true, true, true, true, true, true]);
    expect(results[10]).toBe(false);
  });

  it("counts each user separately", async () => {
    expect(await withinProbeLimit("probe-user-b")).toBe(true);
  });
});
