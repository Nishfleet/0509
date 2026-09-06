import { expect, test } from "@playwright/test";

import { runSurfaceAudit } from "./surface-audit.mjs";

test.describe("authenticated surface audit", () => {
  test("logged-in dark wide paid-tier cells stay mechanically clean", async ({ baseURL }) => {
    test.setTimeout(15 * 60 * 1000);
    const result = await runSurfaceAudit({ base: baseURL });
    expect(result.checked).toBeGreaterThan(0);
    expect(result.failures, result.failures.map((failure) => JSON.stringify(failure)).join("\n")).toEqual([]);
  });
});
