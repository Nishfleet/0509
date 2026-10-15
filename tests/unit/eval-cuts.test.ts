import { describe, expect, it } from "vitest";

import { formatCuts, kindCuts, type CutSample } from "../evals/cuts";

function samples(kind: string, pairs: readonly [number, boolean][]): CutSample[] {
  return pairs.map(([p, label]) => ({ kind, label, p }));
}

describe("kindCuts", () => {
  it("finds the cut that separates noteworthy from noise", () => {
    const [copy] = kindCuts(
      samples("copy", [
        [0.8, true],
        [0.7, true],
        [0.65, true],
        [0.4, false],
        [0.3, false],
        [0.2, false],
      ]),
    );
    expect(copy).toMatchObject({ kind: "copy", cut: 0.65, precision: 1, recall: 1, shippedActs: 0 });
  });

  it("holds back a kind with too few samples", () => {
    const [launch] = kindCuts(samples("launch", [[0.9, true]]));
    expect(launch).toMatchObject({ cut: null, shippedActs: 1, shippedPrecision: 1 });
  });

  it("measures pricing against its own shipped cut", () => {
    const [pricing] = kindCuts(
      samples("pricing", [
        [0.7, true],
        [0.65, true],
        [0.62, false],
        [0.5, false],
        [0.3, false],
      ]),
    );
    expect(pricing).toMatchObject({ shippedActs: 3, shippedPrecision: 0.667 });
  });

  it("prints a table with a line per kind", () => {
    const text = formatCuts(kindCuts([...samples("copy", []), ...samples("offer", [[0.9, true]])]));
    expect(text.split("\n")).toHaveLength(2);
  });
});
