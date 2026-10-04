import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { brandMonogram } from "../app/components/brand-chip";
import { Monogram } from "../app/components/monogram";

describe("brandMonogram", () => {
  it("takes the first grapheme, upper-cased", () => {
    expect(brandMonogram("gymshark")).toBe("G");
  });

  it("trims the name before taking the first grapheme", () => {
    expect(brandMonogram("  on ")).toBe("O");
  });

  it("returns an empty string for a blank name", () => {
    expect(brandMonogram("")).toBe("");
    expect(brandMonogram("   ")).toBe("");
  });

  it("returns the whole emoji, not half a surrogate pair", () => {
    const monogram = brandMonogram("👍 Team");

    expect(monogram).toBe("👍");
    expect(monogram.length).toBe(2);
  });

  it("keeps a combining mark and a ZWJ sequence as one grapheme", () => {
    expect(brandMonogram("e\u0301 team")).toBe("E\u0301");
    expect(brandMonogram("👨‍👩‍👧 Team")).toBe("👨‍👩‍👧");
  });
});

describe("Monogram", () => {
  it("renders an emoji-first name whole and hidden from screen readers", () => {
    const html = renderToStaticMarkup(createElement(Monogram, { name: "👍 Team" }));
    const text = /<span\b[^>]*>([^<]*)<\/span>/.exec(html)?.[1];

    expect(html).toContain('aria-hidden="true"');
    expect(text).toBe(brandMonogram("👍 Team"));
  });
});
