import { describe, expect, it } from "vitest";

// Deliberate shard-failure drill for 0509#3261: this file exists ONLY in the
// drill commit, to prove on CI that a red shard turns the required
// `codex-node-checks` context red via the aggregate step and blocks the merge.
// It is removed in the next commit; the final PR diff carries no drill.
describe("ci shard drill (0509#3261)", () => {
  it("fails on purpose so the shard-check aggregate must turn the required context red", () => {
    expect(1).toBe(2);
  });
});
