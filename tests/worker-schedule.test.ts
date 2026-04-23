import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("worker schedule", () => {
  it("keeps discovery warmup on a bounded six-hour cadence", () => {
    const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");

    expect(wranglerConfig).toContain('"17 */6 * * *"');
    expect(wranglerConfig).not.toContain('"*/30 * * * *"');
  });
});
