import { describe, expect, it } from "vitest";

import { computeBreakageEvidence } from "../../app/lib/site/breakage-evidence";

// 0509#6490: app/lib/site/breakage-evidence.ts is pure string and number work,
// so it runs in the node project. The workers copy inside
// tests/integration/site/judge.integration.test.ts stays where it is; this file
// is the copy that counts toward the node branch floor. Every branch is pinned
// here: the status >= 400 comparison on both sides, the strict half-text
// comparison on both sides, each currency in countPrices with and without its
// optional space, the no-match nullish arm, and both arms of pricesVanished.
describe("computeBreakageEvidence", () => {
  it("flips httpError at status 400 and leaves 399 clear", () => {
    const before = "Pro plan £40 a month for teams of ten or more";
    expect(computeBreakageEvidence({ status: 399, beforeText: before, afterText: before }).httpError).toBe(false);
    expect(computeBreakageEvidence({ status: 400, beforeText: before, afterText: before }).httpError).toBe(true);
  });

  it("is not textHalved at exactly half and is one character below", () => {
    const beforeText = "abcd";
    const exactlyHalf = computeBreakageEvidence({ status: 200, beforeText, afterText: "ab" });
    expect(exactlyHalf.textHalved).toBe(false);
    expect(exactlyHalf.beforeChars).toBe(4);
    expect(exactlyHalf.afterChars).toBe(2);

    const oneBelow = computeBreakageEvidence({ status: 200, beforeText, afterText: "a" });
    expect(oneBelow.textHalved).toBe(true);
    expect(oneBelow.afterChars).toBe(1);
  });

  it("counts each currency with and without a space before the digit", () => {
    const evidence = computeBreakageEvidence({
      status: 200,
      beforeText: "£10 $20 €30 ₹40 £ 50 $ 60 € 70 ₹ 80",
      afterText: "£10 $20 €30 ₹40 £ 50 $ 60 € 70 ₹ 80",
    });
    expect(evidence.pricesBefore).toBe(8);
    expect(evidence.pricesAfter).toBe(8);
  });

  it("flags pricesVanished only when there were prices before and none after", () => {
    const vanished = computeBreakageEvidence({ status: 200, beforeText: "From £40 a month", afterText: "Error" });
    expect(vanished.pricesBefore).toBe(1);
    expect(vanished.pricesAfter).toBe(0);
    expect(vanished.pricesVanished).toBe(true);

    const pricedOnBoth = computeBreakageEvidence({ status: 200, beforeText: "From £40 a month", afterText: "From £45" });
    expect(pricedOnBoth.pricesAfter).toBe(1);
    expect(pricedOnBoth.pricesVanished).toBe(false);

    const noneToBeginWith = computeBreakageEvidence({ status: 200, beforeText: "Plans", afterText: "Error" });
    expect(noneToBeginWith.pricesBefore).toBe(0);
    expect(noneToBeginWith.pricesAfter).toBe(0);
    expect(noneToBeginWith.pricesVanished).toBe(false);
  });

  it("reads two empty strings as zeroes and no vanished prices", () => {
    expect(computeBreakageEvidence({ status: 204, beforeText: "", afterText: "" })).toEqual({
      status: 204,
      httpError: false,
      beforeChars: 0,
      afterChars: 0,
      textHalved: false,
      pricesBefore: 0,
      pricesAfter: 0,
      pricesVanished: false,
    });
  });
});
