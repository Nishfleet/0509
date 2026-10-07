import { describe, expect, it } from "vitest";

import { formatScore } from "../app/lib/score-format";

describe("formatScore", () => {
  it.each([
    [3 * 0.6, "1.8"],
    [3 * 0.7, "2.1"],
    [4 * 0.6, "2.4"],
    [3, "3"],
    [1, "1"],
    [0.9, "0.9"],
    [2 * 3 * 0.9, "5.4"],
    [1.005 + 0.001, "1.01"],
    [1000, "1000"],
    [1234.5, "1234.5"],
  ])("formats %s as %s", (value, shown) => {
    expect(formatScore(value)).toBe(shown);
  });
});
