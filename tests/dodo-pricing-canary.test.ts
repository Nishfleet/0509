import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Dodo pricing canary script", () => {
  it("bounds live pricing preview fetches with an abort timeout", () => {
    const source = readFileSync("scripts/dodo-pricing-canary.mjs", "utf8");

    expect(source).toContain("DODO_PRICING_CANARY_TIMEOUT_MS");
    expect(source).toContain("signal: AbortSignal.timeout(DODO_PRICING_CANARY_TIMEOUT_MS)");
  });
});
