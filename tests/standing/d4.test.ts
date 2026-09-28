import { describe, expect, it } from "vitest";

import {
  D4_QUESTION_ID,
  pickReadThisFirst,
  readThisFirstLine,
  type D4Verdict,
} from "../../app/lib/read-this-first";

const verdict = (signalId: string, p: number, observedAt: string): D4Verdict => ({
  signalId,
  p,
  observedAt,
});

describe("pickReadThisFirst", () => {
  it("drops anything below the 0.5 gate and keeps exactly 0.5", () => {
    expect(
      pickReadThisFirst([verdict("a", 0.49, "2026-09-20T00:00:00.000Z"), verdict("b", 0.5, "2026-09-20T00:00:00.000Z")]),
    ).toEqual(["b"]);
  });

  it("orders by p descending", () => {
    expect(
      pickReadThisFirst([
        verdict("low", 0.6, "2026-09-20T00:00:00.000Z"),
        verdict("high", 0.9, "2026-09-20T00:00:00.000Z"),
        verdict("mid", 0.7, "2026-09-20T00:00:00.000Z"),
      ]),
    ).toEqual(["high", "mid", "low"]);
  });

  it("breaks a tie on p with the newer observedAt first", () => {
    expect(
      pickReadThisFirst([
        verdict("older", 0.8, "2026-09-18T00:00:00.000Z"),
        verdict("newer", 0.8, "2026-09-19T00:00:00.000Z"),
      ]),
    ).toEqual(["newer", "older"]);
  });

  it("returns the first three when five clear the gate", () => {
    const verdicts = [
      verdict("first", 0.95, "2026-09-21T00:00:00.000Z"),
      verdict("second", 0.9, "2026-09-21T00:00:00.000Z"),
      verdict("third", 0.85, "2026-09-21T00:00:00.000Z"),
      verdict("fourth", 0.8, "2026-09-21T00:00:00.000Z"),
      verdict("fifth", 0.75, "2026-09-21T00:00:00.000Z"),
    ];
    expect(pickReadThisFirst(verdicts)).toEqual(["first", "second", "third"]);
  });

  it("returns an empty list when nothing clears the gate", () => {
    expect(pickReadThisFirst([verdict("a", 0.1, "2026-09-21T00:00:00.000Z")])).toEqual([]);
    expect(pickReadThisFirst([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const verdicts: D4Verdict[] = [
      verdict("a", 0.6, "2026-09-18T00:00:00.000Z"),
      verdict("b", 0.9, "2026-09-21T00:00:00.000Z"),
      verdict("c", 0.4, "2026-09-19T00:00:00.000Z"),
    ];
    const copy = verdicts.map((v) => ({ ...v }));
    pickReadThisFirst(verdicts);
    expect(verdicts).toEqual(copy);
  });
});

describe("readThisFirstLine", () => {
  it("names the counts and the lead", () => {
    expect(readThisFirstLine(2, 5, "Acme")).toBe("2 of 5 worth knowing this week, led by Acme.");
  });
});

describe("public contract", () => {
  it("names the D4 question", () => {
    expect(D4_QUESTION_ID).toBe("read_this_first");
  });
});
