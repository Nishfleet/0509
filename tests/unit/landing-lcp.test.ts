import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The staged homepage is /design/landing. Its h1 is the LCP element. The
// glyphs for that line live in a small same-origin face. The 77KB display
// file does not cover them, so first paint does not wait on that request.

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function codepoints(text: string): number[] {
  const chars = [...text, ...[...text].map((char) => char.toUpperCase())];
  return [...new Set(chars.map((char) => char.codePointAt(0) ?? 0))];
}

function ranges(css: string, family: string): Set<number> {
  const faces = css.split("@font-face").slice(1);
  const face = faces.find((block) => block.includes(`font-family: "${family}"`));
  expect(face, family).toBeTruthy();
  const listed = face?.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "";
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

const heroSource = readFileSync(join(REPO_ROOT, "app/components/landing/hero.tsx"), "utf8");
const heroText = heroSource.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/)?.[1] ?? "";
const heroFace = readFileSync(join(REPO_ROOT, "app/components/landing/hero-face.css"), "utf8");
const appCss = readFileSync(join(REPO_ROOT, "app/app.css"), "utf8");
const root = readFileSync(join(REPO_ROOT, "app/root.tsx"), "utf8");
const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

describe("landing LCP critical path", () => {
  it("paints the hero from the small face, not the full display file", () => {
    expect(heroText.length).toBeGreaterThan(20);
    const bytes = readFileSync(join(REPO_ROOT, "public/fonts/bricolage-hero.woff2"));
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(bytes.length).toBeLessThan(12_000);
    expect(heroFace).toContain('url("/fonts/bricolage-hero.woff2")');
    expect(heroFace).not.toContain("bricolage-grotesque-latin");
    const covered = ranges(heroFace, "Bricolage Grotesque");
    for (const code of codepoints(heroText)) {
      expect(covered.has(code), `U+${code.toString(16)}`).toBe(true);
    }
  });

  it("does not let the full display file claim the hero characters", () => {
    const covered = ranges(appCss, "Bricolage Grotesque");
    for (const code of codepoints(heroText)) {
      expect(covered.has(code), `U+${code.toString(16)}`).toBe(false);
    }
    expect(appCss).toContain("/fonts/bricolage-grotesque-latin.woff2");
    const heroRange = heroFace.match(/unicode-range:\s*([^;]+);/)?.[1];
    const appHero = appCss.split("@font-face").find((block) => block.includes("bricolage-hero.woff2"));
    expect(appHero).toContain(heroRange);
  });

  it("collects the staged homepage with the local worker secret", () => {
    const collect = ci.split("\n").find((line) => line.includes("@lhci/cli") && line.includes(" collect "));
    expect(collect).toContain("--url=http://127.0.0.1:$P/design/landing");
    expect(collect).toContain("--env-file .dev.vars.example");
  });

  it("keeps the landing document off the full font and the module graph until after paint", () => {
    expect(root).toContain('href="/fonts/bricolage-hero.woff2"');
    expect(root).toContain('href="/landing-critical.css"');
    expect(root).toContain('id="landing-deferred"');
    expect(root).toContain("requestAnimationFrame");
    expect(root).toContain('rel="preload" href="/fonts/bricolage-grotesque-latin.woff2"');
  });
});
