import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandChip, BrandChipRow, type BrandChipBrand } from "../app/components/brand-chip";

function chip(props: BrandChipBrand): string {
  return renderToStaticMarkup(createElement(BrandChip, props));
}

describe("BrandChip refuses a name or an href it cannot show", () => {
  it("renders nothing for a name that is only whitespace", () => {
    expect(BrandChip({ name: "  ", href: "https://a.example" })).toBeNull();
  });

  it("renders nothing for an href that is not a safe web address", () => {
    expect(BrandChip({ name: "On", href: "javascript:alert(1)" })).toBeNull();
    expect(BrandChip({ name: "On", href: "//evil.example" })).toBeNull();
  });
});

describe("BrandChip anchors an https href without leaking the opener", () => {
  it("renders the brand name and adds rel=noreferrer", () => {
    const html = chip({ name: "On", href: "https://a.example" });
    expect(html).toContain('href="https://a.example/"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("On");
  });
});

describe("BrandChip names the flags it was given", () => {
  it("names a brand of your own as You", () => {
    expect(chip({ name: "On", href: "https://a.example", self: true })).toContain("You · On");
  });

  it("names a brand you switched off", () => {
    expect(chip({ name: "On", href: "https://a.example", off: true })).toContain("On · off");
  });

  it("keeps both names when your own brand is switched off", () => {
    expect(chip({ name: "On", href: "https://a.example", self: true, off: true })).toContain("You · On · off");
  });
});

describe("BrandChip only loads a logo from this site", () => {
  it("drops a logo served from another origin and keeps the monogram", () => {
    const html = chip({ name: "On", href: "https://a.example", logoUrl: "https://cdn.example/x.png" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("cdn.example");
    expect(html).toContain(">O<");
  });
});

describe("BrandChipRow shows the add link only when it has somewhere to go", () => {
  it("omits the add link when no addHref is given", () => {
    const html = renderToStaticMarkup(
      createElement(BrandChipRow, { brands: [{ name: "On", href: "https://a.example/on" }] }),
    );
    expect(html).not.toContain("+ Add a competitor");
  });

  it("renders the add link for an https addHref", () => {
    const html = renderToStaticMarkup(createElement(BrandChipRow, { brands: [], addHref: "https://a.example/add" }));
    expect(html).toContain("+ Add a competitor");
    expect(html).toContain('href="https://a.example/add"');
  });

  it("omits the add link for an addHref that is not a safe web address", () => {
    const html = renderToStaticMarkup(createElement(BrandChipRow, { brands: [], addHref: "javascript:alert(1)" }));
    expect(html).not.toContain("+ Add a competitor");
  });
});
