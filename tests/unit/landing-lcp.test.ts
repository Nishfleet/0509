import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Landing from "../../app/routes/landing";
import { links as productLinks } from "../../app/routes/faces-layout";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

interface Face {
  family: string;
  weights: number[];
  ranges: [number, number][];
  src: string;
  display: string;
}

function parseFaces(css: string): Face[] {
  return css
    .split("@font-face")
    .slice(1)
    .map((block) => {
      const body = block.slice(0, block.indexOf("}"));
      const family = /font-family:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
      const weight = /font-weight:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? "";
      const weights = weight.split(/\s+/).map((part) => Number(part));
      const rangeText = /unicode-range:\s*([^;]+)/.exec(body)?.[1] ?? "";
      const ranges = rangeText.split(",").map((part) => {
        const bits = part
          .trim()
          .replace("U+", "")
          .split("-")
          .map((hex) => Number.parseInt(hex, 16));
        const start = bits[0] ?? Number.NaN;
        return [start, bits[1] ?? start] as [number, number];
      });
      const src = /url\("([^"]+)"\)/.exec(body)?.[1] ?? "";
      const display = /font-display:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? "";
      return { family, weights, ranges, src, display };
    });
}

function covers(face: Face, code: number): boolean {
  return face.ranges.some(([start, end]) => code >= start && code <= end);
}

function weightMatches(face: Face, weight: number): boolean {
  if (face.weights.length === 1) return face.weights[0] === weight;
  if (face.weights.length === 2) {
    const [low, high] = face.weights;
    return low !== undefined && high !== undefined && weight >= low && weight <= high;
  }
  return false;
}

function faceFor(faces: Face[], family: string, weight: number, code: number): Face | undefined {
  return faces.find((face) => face.family === family && weightMatches(face, weight) && covers(face, code));
}

function tokens(className: string): string[] {
  return className.split(/\s+/);
}

function weightOf(className: string): number {
  const names = tokens(className);
  if (names.includes("font-extrabold")) return 800;
  if (names.includes("font-bold")) return 700;
  if (names.includes("font-semibold")) return 600;
  if (names.includes("font-medium")) return 500;
  return 400;
}

function familyOf(className: string): string {
  const names = tokens(className);
  if (names.includes("font-display")) return "Bricolage Grotesque";
  if (names.includes("font-mono")) return "IBM Plex Mono";
  return "Instrument Sans";
}

function cssImportedBy(routeFile: string): string {
  const source = readFileSync(routeFile, "utf8");
  const dir = dirname(routeFile);
  return [...source.matchAll(/import\s+"(\.[^"]+\.css)"/g)]
    .map((match) => readFileSync(join(dir, match[1] ?? ""), "utf8"))
    .join("\n");
}

describe("landing LCP critical path", () => {
  it("paints the server headline from a face that is already in the stylesheet", () => {
    const html = renderToStaticMarkup(createElement(Landing));
    const heading = /<h1 id="hero-title" class="([^"]+)">([\s\S]*?)<\/h1>/.exec(html);
    expect(heading).not.toBeNull();
    const className = heading?.[1] ?? "";
    const headline = (heading?.[2] ?? "").replace(/\s+/g, " ").trim();
    expect(headline).toContain("Know where you stand.");
    const painted = tokens(className).includes("uppercase") ? headline.toLocaleUpperCase("en-US") : headline;

    const landingCss = cssImportedBy(join(REPO_ROOT, "app/routes/landing.tsx"));
    const faces = parseFaces(landingCss);
    const family = familyOf(className);
    const weight = weightOf(className);
    const sources = new Set<string>();
    for (const char of painted) {
      const code = char.codePointAt(0);
      expect(code).toBeTypeOf("number");
      const face = faceFor(faces, family, weight, code ?? 0);
      expect(face, `U+${(code ?? 0).toString(16)} has no ${family} ${weight} face`).toBeDefined();
      expect(face?.display).toBe("swap");
      sources.add(face?.src ?? "");
    }
    expect(sources).toEqual(new Set(["/fonts/bricolage-hero.woff2"]));
    expect(landingCss).not.toContain("bricolage-grotesque-latin");
    expect(html).toContain('href="/fonts/bricolage-hero.woff2"');
    expect(html).toContain('rel="preload"');

    const shipped = readFileSync(join(REPO_ROOT, "public/fonts/bricolage-hero.woff2"));
    expect(shipped.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(shipped.length).toBeLessThan(12_000);
  });

  it("keeps weights 700 and 800 on the full face for every other document", () => {
    const faces = parseFaces(cssImportedBy(join(REPO_ROOT, "app/routes/faces-layout.tsx")));
    for (const weight of [700, 800]) {
      for (const char of "Aa .") {
        const face = faceFor(faces, "Bricolage Grotesque", weight, char.codePointAt(0) ?? 0);
        expect(face?.src, `weight ${weight} ${char}`).toBe("/fonts/bricolage-grotesque-latin.woff2");
        expect(face?.display).toBe("swap");
      }
    }
    const head = productLinks().map((descriptor) =>
      typeof descriptor === "string" ? descriptor : (descriptor.href ?? ""),
    );
    expect(head).toContain("/fonts/bricolage-grotesque-latin.woff2");
    expect(head).toContain("/fonts/instrument-sans-latin.woff2");
    expect(head.join(" ")).not.toContain("data:font");
  });
});
