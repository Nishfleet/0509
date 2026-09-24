import { describe, expect, it } from "vitest";

import { coMentions, leadingName } from "../../../app/lib/discovery/co-mentions";

const BRAND = "Gymshark";

describe("coMentions", () => {
  it("returns the other brands listed beside the subject in one headline", () => {
    expect(coMentions("Uniqlo, Gymshark and Lush stop hiring UK workers via gig economy apps", BRAND)).toEqual([
      "Uniqlo",
      "Lush",
    ]);
  });

  it("reads a versus headline and drops the trailing publisher clause", () => {
    expect(coMentions("Gymshark vs Alphalete Athletics: which leggings last? - Glamour UK", BRAND)).toEqual([
      "Alphalete Athletics",
    ]);
  });

  it("returns nothing when the brand appears alone in a clause", () => {
    expect(coMentions("Show HN: I built a Gymshark tracker", BRAND)).toEqual([]);
  });

  it("returns nothing when the brand is absent from the text", () => {
    expect(coMentions("Nike and Adidas report earnings", BRAND)).toEqual([]);
  });

  it("returns nothing when every listed name is the brand in another case", () => {
    expect(coMentions("Gymshark, gymshark and GYMSHARK", BRAND)).toEqual([]);
  });

  it("dedupes case-insensitively and keeps the first spelling seen", () => {
    expect(coMentions("Gymshark or Lululemon or lululemon", BRAND)).toEqual(["Lululemon"]);
  });

  it("dedupes a second capitalised spelling, which the lowercase twin cannot prove on its own", () => {
    expect(coMentions("Gymshark or Lululemon or LULULEMON", BRAND)).toEqual(["Lululemon"]);
  });
});

describe("coMentions on a Title Case headline (0509#4436)", () => {
  it("never reads the last item's predicate as part of a name", () => {
    expect(coMentions("Gymshark And Nike Report Record Growth", BRAND)).toEqual([]);
    expect(coMentions("Gymshark And Nike Report Record Growth - Reuters", BRAND)).toEqual([]);
  });

  it("still takes a name that a separator closes on both sides", () => {
    expect(coMentions("Nike, Gymshark And Adidas Report Record Growth", BRAND)).toEqual(["Nike"]);
  });

  it("leaves a sentence-case headline alone", () => {
    expect(coMentions("Gymshark and Nike report record growth", BRAND)).toEqual(["Nike"]);
  });
});

describe("leadingName", () => {
  it("returns the leading capitalised run", () => {
    expect(leadingName("Lush stop hiring")).toBe("Lush");
  });

  it("returns null when the first word is not capitalised", () => {
    expect(leadingName("the best ones")).toBeNull();
  });

  it("returns null when the run is longer than four words", () => {
    expect(leadingName("One Two Three Four Five")).toBeNull();
  });
});
