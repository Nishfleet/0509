import { describe, expect, it } from "vitest";

import {
  scrubBrokenUnicode,
  truncateTextSafe,
} from "~/lib/text-safe";

const U_FFFD = "\uFFFD";
const SPARKLES = "\u2728"; // ✨ BMP emoji — a single UTF-16 code unit
const STAR = "\uD83C\uDF1F"; // 🌟 astral emoji — a surrogate pair
const LONE_HIGH = "\uD83C"; // orphaned first half of 🌟
const LONE_LOW = "\uDF1F"; // orphaned second half of 🌟

describe("truncateTextSafe", () => {
  it("returns values at or under the cap unchanged", () => {
    expect(truncateTextSafe("abc", 3)).toBe("abc");
    expect(truncateTextSafe("", 120)).toBe("");
  });

  it("cuts plain BMP text at the cap", () => {
    expect(truncateTextSafe("abcdef", 3)).toBe("abc");
  });

  it("never splits a surrogate pair at the boundary", () => {
    // Units: a(0..118) + high🌟(119) + low🌟(120) + b(121)
    const value = "a".repeat(119) + STAR + "b";
    const cut = truncateTextSafe(value, 120);
    expect(cut).toBe("a".repeat(119));
    expect(/[\uD800-\uDFFF]/.test(cut)).toBe(false);
  });

  it("keeps an emoji that fits entirely inside the cap", () => {
    const value = "a".repeat(118) + STAR + "b";
    expect(truncateTextSafe(value, 120)).toBe("a".repeat(118) + STAR);
    expect(truncateTextSafe("French Pharmacy collection " + SPARKLES, 40)).toBe(
      "French Pharmacy collection " + SPARKLES,
    );
  });

  it("drops the dangling half of an emoji exactly at the cap", () => {
    const value = "a".repeat(118) + SPARKLES + STAR; // unit 119 is high🌟
    const cut = truncateTextSafe(value, 120);
    expect(cut).toBe("a".repeat(118) + SPARKLES);
    expect(/[\uD800-\uDFFF]/.test(cut)).toBe(false);
  });

  it("handles a zero-length cap", () => {
    expect(truncateTextSafe("anything", 0)).toBe("");
  });
});

describe("scrubBrokenUnicode", () => {
  it("removes persisted U+FFFD replacement characters", () => {
    expect(scrubBrokenUnicode(`French Pharmacy collection ${U_FFFD}`)).toBe(
      "French Pharmacy collection ",
    );
    expect(scrubBrokenUnicode(`${U_FFFD}${U_FFFD}lead`)).toBe("lead");
  });

  it("removes lone high and low surrogates", () => {
    expect(scrubBrokenUnicode(`abc${LONE_HIGH}def`)).toBe("abcdef");
    expect(scrubBrokenUnicode(`abc${LONE_LOW}def`)).toBe("abcdef");
    // A high surrogate followed by a non-low unit is a lone high; a low
    // surrogate not preceded by a high is a lone low. (Note: a high directly
    // followed by a low is a well-formed emoji pair and is preserved.)
    expect(scrubBrokenUnicode(`${LONE_HIGH}x${LONE_LOW}`)).toBe("x");
  });

  it("preserves well-formed emoji pairs exactly", () => {
    const value = `French Pharmacy collection ${STAR} ${SPARKLES}`;
    expect(scrubBrokenUnicode(value)).toBe(value);
  });

  it("cleans a realistic mixed string while keeping real emoji", () => {
    const input = `Nykaa ${U_FFFD} ${STAR} ${LONE_HIGH} launch`;
    const cleaned = scrubBrokenUnicode(input);
    expect(cleaned).toBe(`Nykaa  ${STAR}  launch`);
    expect(cleaned).not.toContain(U_FFFD);
    // No LONE surrogates remain — only the well-formed pair of 🌟.
    expect(cleaned).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  });
});
