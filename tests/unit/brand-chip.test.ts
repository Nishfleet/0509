import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { BrandChip, BrandChipRow, brandMonogram, type BrandChipBrand } from "../../app/components/brand-chip";

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

function chip(props: BrandChipBrand): string {
  return render(createElement(BrandChip, props));
}

function anchorClass(html: string): string {
  return /^<a\b[^>]*\sclass="([^"]*)"/.exec(html)?.[1] ?? "";
}

describe("the brand chip", () => {
  it("derives the monogram from the brand name", () => {
    expect(brandMonogram("gymshark")).toBe("G");
    expect(brandMonogram("  école ")).toBe("É");
    expect(brandMonogram("   ")).toBe("");
  });

  it("lists every brand in the row, including one whose logo will fail", () => {
    const html = render(
      createElement(BrandChipRow, {
        addHref: "/onboarding",
        brands: [
          { name: "Loopwell", href: "/app/competitors/loopwell", self: true },
          {
            name: "Kindred",
            href: "/app/competitors/kindred",
            logoUrl: "/brand-chip-kindred.svg",
          },
          {
            name: "Bramble",
            href: "/app/competitors/bramble",
            logoUrl: "/brand-chip-missing.png",
          },
          { name: "Fieldset", href: "/app/competitors/fieldset" },
          {
            name: "Northbeam International Holdings Group of the Northern Markets",
            href: "/app/competitors/northbeam",
          },
          { name: "Casetta", href: "/app/competitors/casetta", off: true },
        ],
      }),
    );
    expect(html).toContain('data-slot="brand-chip-row"');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Brands you watch"');
    expect(html).toContain("You · Loopwell");
    expect(html).toContain('src="/brand-chip-kindred.svg"');
    expect(html).toContain('src="/brand-chip-missing.png"');
    expect(html).toContain(">B<");
    expect(html).toContain("Northbeam International Holdings Group of the Northern Markets");
    expect(html).toContain("Casetta · off");
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain("+ Add a competitor");
    expect(html.match(/data-slot="avatar"/g)?.length).toBe(6);
  });

  it("keeps the default look: the name truncates and the chip may shrink", () => {
    const html = chip({ name: "Northbeam International Holdings", href: "/app/competitors/northbeam" });
    expect(html).toContain('<span class="block min-w-0 truncate">Northbeam International Holdings</span>');
    expect(html).toContain("max-w-full min-w-0 shrink gap-[7px]");
    expect(anchorClass(html)).not.toContain("shrink-0");
    expect(html).not.toContain("break-words");
    expect(html).not.toContain("whitespace-normal");
  });

  it("lets the whole name wrap on its own line only when asked to", () => {
    const html = chip({ name: "Northbeam International Holdings", href: "/app/competitors/northbeam", wrap: true });
    expect(anchorClass(html)).toContain("shrink-0");
    expect(html).toContain("whitespace-normal");
    expect(html).toContain("break-words");
    expect(html).not.toContain("truncate");
    expect(html).toContain("Northbeam International Holdings");
  });
});
