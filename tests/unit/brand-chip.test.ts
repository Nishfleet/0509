import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import {
  BrandChip,
  BrandChipRow,
  brandMonogram,
  type BrandChipBrand,
} from "../../app/components/brand-chip";

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

function chip(props: BrandChipBrand): string {
  return render(createElement(BrandChip, props));
}

describe("the brand chip", () => {
  it("derives the monogram from the brand name", () => {
    expect(brandMonogram("gymshark")).toBe("G");
    expect(brandMonogram("  école ")).toBe("É");
    expect(brandMonogram("   ")).toBe("");
  });

  it("names you, routes inside the app, and keeps the accent monogram when the brand is also off", () => {
    const html = chip({
      name: "Loopwell",
      href: "/app/competitors/loopwell",
      self: true,
      off: true,
    });
    expect(html).toContain('href="/app/competitors/loopwell"');
    expect(html).toContain("You · Loopwell · off");
    expect(html).toContain(">L<");
    expect(html).toContain("data-self");
    expect(html).toContain("data-off");
    expect(html).not.toContain("<img");
    expect(html).toContain("width:26px");
    expect(html).toContain("height:26px");
    expect(html).toContain("min-width:26px");
    expect(html).toContain("min-height:26px");
  });

  it("names an off brand and reserves the monogram box", () => {
    const html = chip({
      name: "Casetta",
      href: "/app/competitors/casetta",
      off: true,
    });
    expect(html).toContain("Casetta · off");
    expect(html).toContain(">C<");
    expect(html).toContain("data-off");
    expect(html).not.toContain("data-self");
    expect(html).toContain("width:26px");
    expect(html).toContain("height:26px");
  });

  it("puts the logo and the monogram in the same reserved box", () => {
    const html = chip({
      name: "Kindred",
      href: "https://0509.test/app/competitors/kindred",
      logoUrl: "https://cdn.example.com/kindred.png",
    });
    expect(html).toContain('href="https://0509.test/app/competitors/kindred"');
    expect(html).toContain('src="https://cdn.example.com/kindred.png"');
    expect(html).toContain('width="26"');
    expect(html).toContain('height="26"');
    expect(html).toContain("width:26px");
    expect(html).toContain("height:26px");
    expect(html).toContain(">K<");
    expect(html).toContain("Kindred");
    expect(html).not.toContain("You ·");
  });

  it("drops a logo that is not an http address and a chip that cannot route", () => {
    expect(
      chip({
        name: "Bramble",
        href: "/app/competitors/bramble",
        logoUrl: "javascript:alert(1)",
      }),
    ).not.toContain("<img");
    expect(chip({ name: "Bramble", href: "javascript:alert(1)" })).toBe("");
    expect(chip({ name: "   ", href: "/app/competitors/bramble" })).toBe("");
    expect(chip({ name: "Bramble", href: "   " })).toBe("");
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
    expect(html).toContain('aria-label="Your set"');
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
});
