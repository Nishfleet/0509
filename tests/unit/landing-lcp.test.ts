import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The staged homepage is /design/landing. Its h1 is the LCP element. Those
// glyphs are covered by the small face only, so the document cannot ask the
// 77KB display file for them.

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function codepoints(text: string): number[] {
  const chars = [...text, ...[...text].map((char) => char.toUpperCase())];
  return [...new Set(chars.map((char) => char.codePointAt(0) ?? 0))];
}

function coveredBy(face: string): Set<number> {
  const listed = face.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "";
  const covered = new Set<number>();
  for (const part of listed.split(",").map((item) => item.trim())) {
    const body = part.replace("U+", "");
    if (!body) continue;
    if (body.includes("-")) {
      const [start, end] = body.split("-").map((value) => Number.parseInt(value, 16));
      for (let code = start; code <= end; code += 1) covered.add(code);
    } else {
      covered.add(Number.parseInt(body, 16));
    }
  }
  return covered;
}

function faceFor(css: string, file: string): string {
  const face = css.split("@font-face").slice(1).find((block) => block.includes(file));
  expect(face, file).toBeTruthy();
  return face ?? "";
}

const heroSource = readFileSync(join(REPO_ROOT, "app/components/landing/hero.tsx"), "utf8");
const heroText = heroSource.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/)?.[1] ?? "";
const appCss = readFileSync(join(REPO_ROOT, "app/app.css"), "utf8");
const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

describe("landing LCP critical path", () => {
  it("covers the hero line with the small face and not the full display file", () => {
    expect(heroText.length).toBeGreaterThan(20);
    const bytes = readFileSync(join(REPO_ROOT, "public/fonts/bricolage-hero.woff2"));
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(bytes.length).toBeLessThan(12_000);
    const hero = coveredBy(faceFor(appCss, "/fonts/bricolage-hero.woff2"));
    const full = coveredBy(faceFor(appCss, "/fonts/bricolage-grotesque-latin.woff2"));
    for (const code of codepoints(heroText)) {
      expect(hero.has(code), `U+${code.toString(16)}`).toBe(true);
      expect(full.has(code), `U+${code.toString(16)}`).toBe(false);
    }
  });

  it("collects the staged homepage with the local worker secret", () => {
    const collect = ci.split("\n").find((line) => line.includes("@lhci/cli") && line.includes(" collect "));
    expect(collect).toContain("--url=http://127.0.0.1:$P/design/landing");
    expect(collect).toContain("--env-file .dev.vars.example");
  });
});
