import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Landing, { links as landingLinks } from "../../app/routes/landing";
import { links as productLinks } from "../../app/routes/faces-layout";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HERO_FACE = "/fonts/bricolage-hero.woff2";
const HERO_RANGES: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0x2013, 0x2014],
  [0x2018, 0x2019],
  [0x201c, 0x201d],
  [0x20ac, 0x20ac],
];

function coversHero(code: number): boolean {
  return HERO_RANGES.some(([start, end]) => code >= start && code <= end);
}

function hrefOf(descriptor: ReturnType<typeof landingLinks>[number]): string {
  return typeof descriptor === "string" ? descriptor : (descriptor.href ?? "");
}

describe("landing LCP critical path", () => {
  it("ships the headline in the first document and preloads the face that covers it", () => {
    const html = renderToStaticMarkup(createElement(Landing));
    const heading = /<h1 id="hero-title" class="([^"]*)">([\s\S]*?)<\/h1>/.exec(html);
    expect(heading).not.toBeNull();
    const className = heading?.[1] ?? "";
    const headline = (heading?.[2] ?? "").replace(/\s+/g, " ").trim();
    expect(headline).toContain("Know where you stand.");
    expect(className.split(/\s+/)).toContain("font-display");
    const painted = className.split(/\s+/).includes("uppercase") ? headline.toLocaleUpperCase("en-US") : headline;
    for (const char of painted) {
      const code = char.codePointAt(0);
      expect(code).toBeTypeOf("number");
      expect(coversHero(code ?? 0), `U+${(code ?? 0).toString(16)}`).toBe(true);
    }

    const heroCss = readFileSync(join(REPO_ROOT, "app/components/landing/hero-face.css"), "utf8");
    expect(heroCss).toContain(`src: url("${HERO_FACE}") format("woff2")`);
    expect(heroCss).toContain("font-display: swap");
    expect(heroCss).toContain("unicode-range: U+0020-007E, U+2013-2014, U+2018-2019, U+201C-201D, U+20AC");
    expect(heroCss).not.toContain("bricolage-grotesque-latin");

    const fontPreloads = landingLinks().filter(
      (descriptor) => typeof descriptor !== "string" && descriptor.rel === "preload" && descriptor.as === "font",
    );
    expect(fontPreloads.map(hrefOf)).toEqual([HERO_FACE]);

    const shipped = readFileSync(join(REPO_ROOT, "public/fonts/bricolage-hero.woff2"));
    expect(shipped.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(shipped.length).toBeLessThan(12_000);
  });

  it("preloads the full display and body faces for every other document", () => {
    const display = readFileSync(join(REPO_ROOT, "app/fonts-display.css"), "utf8");
    expect(display).toContain('font-family: "Bricolage Grotesque"');
    expect(display).toContain("font-weight: 700 800");
    expect(display).toContain('src: url("/fonts/bricolage-grotesque-latin.woff2")');
    expect(display).toContain("font-display: swap");
    const head = productLinks().map(hrefOf);
    expect(head).toContain("/fonts/bricolage-grotesque-latin.woff2");
    expect(head).toContain("/fonts/instrument-sans-latin.woff2");
    expect(head.join(" ")).not.toContain("data:font");
    expect(head).not.toContain(HERO_FACE);
  });
});
