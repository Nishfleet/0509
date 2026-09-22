// @vitest-environment happy-dom
import { createElement, type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Window } from "happy-dom";

import {
  BrandChip,
  BrandChipRow,
  brandMonogram,
  type BrandChipBrand,
} from "../../app/components/brand-chip";

function ensureDom(): void {
  if (typeof document !== "undefined") return;
  const win = new Window({ url: "https://0509.test/app" });
  Object.assign(globalThis, { window: win, document: win.document });
}

ensureDom();

function chip(props: BrandChipBrand): string {
  const element: ReactElement | null = createElement(BrandChip, props);
  return renderToStaticMarkup(element);
}

function installFailingImage(): void {
  class FailImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    complete = false;
    naturalWidth = 0;
    referrerPolicy = "";
    crossOrigin: string | null = null;
    sizes = "";
    srcset = "";
    set src(_value: string) {
      this.complete = true;
      this.naturalWidth = 0;
      this.onerror?.();
    }
  }
  vi.stubGlobal("Image", FailImage);
  window.Image = FailImage as unknown as typeof window.Image;
}

describe("the brand chip", () => {
  let root: Root | null = null;

  afterEach(() => {
    root?.unmount();
    root = null;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("derives the monogram from the brand name", () => {
    expect(brandMonogram("gymshark")).toBe("G");
    expect(brandMonogram("  école ")).toBe("É");
    expect(brandMonogram("   ")).toBe("");
  });

  it("marks you with the accent monogram and routes to that brand", () => {
    const html = chip({
      name: "Loopwell",
      href: "/app/competitors/loopwell",
      self: true,
      off: true,
    });
    expect(html).toContain('href="/app/competitors/loopwell"');
    expect(html).toContain("You · Loopwell");
    expect(html).toContain(">L<");
    expect(html).toContain("data-self");
    expect(html).toContain("bg-accent");
    expect(html).not.toContain("data-off");
    expect(html).not.toContain("border-dashed");
    expect(html).not.toContain("<img");
  });

  it("renders an off brand dashed and dimmed", () => {
    const html = chip({
      name: "Casetta",
      href: "/app/competitors/casetta",
      off: true,
    });
    expect(html).toContain("Casetta · off");
    expect(html).toContain(">C<");
    expect(html).toContain("data-off");
    expect(html).toContain("border-dashed");
    expect(html).toContain("text-ink-faint");
    expect(html).toContain("border-line");
  });

  it("reserves a fixed box and keeps the monogram beside a logo", () => {
    const html = chip({
      name: "Kindred",
      href: "https://0509.test/app/competitors/kindred",
      logoUrl: "https://cdn.example.com/kindred.png",
    });
    expect(html).toContain('src="https://cdn.example.com/kindred.png"');
    expect(html).toContain('width="26"');
    expect(html).toContain('height="26"');
    expect(html).toContain("width:26px");
    expect(html).toContain("height:26px");
    expect(html).toContain("min-width:26px");
    expect(html).toContain("min-height:26px");
    expect(html).toContain(">K<");
    expect(html).toContain("data-error:hidden");
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

  it("falls back to the monogram when the logo fails, without resizing the box", async () => {
    installFailingImage();
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        createElement(BrandChip, {
          name: "Kindred",
          href: "/app/competitors/kindred",
          logoUrl: "https://cdn.example.com/missing.png",
        }),
      );
    });
    const avatar = host.querySelector("[data-slot='avatar']");
    const image = host.querySelector("[data-slot='avatar-image']");
    expect(avatar?.getAttribute("style")).toContain("width: 26px");
    expect(avatar?.getAttribute("style")).toContain("height: 26px");
    expect(image?.getAttribute("data-error")).not.toBeNull();
    expect(image?.className).toContain("data-error:hidden");
    expect(host.textContent).toContain("K");
    expect(host.textContent).toContain("Kindred");
  });

  it("wraps a row of brands and ellipsizes a long name", () => {
    const html = renderToStaticMarkup(
      createElement(BrandChipRow, {
        addHref: "/onboarding",
        brands: [
          { name: "Loopwell", href: "/app/competitors/loopwell", self: true },
          { name: "Kindred", href: "/app/competitors/kindred" },
          { name: "Bramble", href: "/app/competitors/bramble" },
          { name: "Fieldset", href: "/app/competitors/fieldset" },
          {
            name: "Northbeam International Holdings",
            href: "/app/competitors/northbeam",
          },
          { name: "Casetta", href: "/app/competitors/casetta", off: true },
        ],
      }),
    );
    expect(html).toContain('data-slot="brand-chip-row"');
    expect(html).toContain("flex-wrap");
    expect(html).toContain("truncate");
    expect(html).toContain("Northbeam International Holdings");
    expect(html).toContain("You · Loopwell");
    expect(html).toContain("Casetta · off");
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain("+ Add a competitor");
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("overflow-x-scroll");
  });
});
