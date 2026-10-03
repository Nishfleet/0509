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
});

describe("Monogram", () => {
  it("renders an emoji-first name whole and hidden from screen readers", () => {
    const html = renderToStaticMarkup(createElement(Monogram, { name: "👍 Team" }));

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(">👍<");
  });
});
