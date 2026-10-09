import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

// Nish asked to adopt shadcn's DESIGN.md skill (2026-10-09). The skill reads
// the YAML frontmatter of DESIGN.md (colors, typography, rounded) and writes
// theme CSS from it, while the app reads the @theme block of app/app.css.
// Two sources for one set of tokens drift silently, so this test fails when a
// mapped token differs in either file, or exists in one and not the other.
// Dark-mode values, ease, duration and the shadcn role aliases have no schema
// key and are not mapped; the PR that added this test lists them.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const Frontmatter = z.object({
  colors: z.record(z.string(), z.string()),
  typography: z.record(
    z.string(),
    z.object({
      fontFamily: z.string(),
      fontSize: z.string(),
      lineHeight: z.number(),
      letterSpacing: z.string(),
    }),
  ),
  rounded: z.record(z.string(), z.string()),
});

function frontmatter() {
  const source = readFileSync(path.join(ROOT, "DESIGN.md"), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match?.[1]) throw new Error("DESIGN.md has no YAML frontmatter");
  return Frontmatter.parse(parse(match[1]));
}

function declarations(css: string, opener: string) {
  const start = css.indexOf(`\n${opener} {\n`);
  if (start < 0) throw new Error(`app/app.css has no ${opener} block`);
  const end = css.indexOf("\n}\n", start);
  const body = css.slice(start, end);
  return new Map([...body.matchAll(/^\s*(--[\w-]+):\s*(.+?);/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]));
}

const css = readFileSync(path.join(ROOT, "app", "app.css"), "utf8");
const theme = declarations(css, "@theme");
const light = declarations(css, ":root");
const design = frontmatter();

const RAW_COLORS = [...theme.keys()]
  .filter((key) => key.startsWith("--color-") && theme.get(key) === `var(--${key.slice(8)})`)
  .map((key) => key.slice(8))
  .filter((name) => light.has(`--${name}`));
const SCALE = [...theme.keys()].filter((key) => /^--text-[\w-]+$/.test(key) && !key.includes("--", 2));
const RADII = [...theme.keys()].filter((key) => key.startsWith("--radius-"));
const FAMILIES = ["--font-display", "--font-sans", "--font-mono"].map((key) => theme.get(key));

describe("DESIGN.md frontmatter matches the app.css tokens", () => {
  it("maps every palette colour to the light value in :root and the @theme alias", () => {
    expect(Object.keys(design.colors).sort()).toEqual([...RAW_COLORS].sort());
    for (const [name, value] of Object.entries(design.colors)) {
      expect(value, `colors.${name}`).toBe(light.get(`--${name}`));
      expect(theme.get(`--color-${name}`), `--color-${name}`).toBe(`var(--${name})`);
    }
  });

  it("maps every type-scale token to its size, line height and tracking", () => {
    expect(Object.keys(design.typography).sort()).toEqual(SCALE.map((key) => key.slice(7)).sort());
    for (const [name, token] of Object.entries(design.typography)) {
      expect(token.fontSize, `${name} size`).toBe(theme.get(`--text-${name}`));
      expect(String(token.lineHeight), `${name} line height`).toBe(theme.get(`--text-${name}--line-height`));
      expect(token.letterSpacing, `${name} tracking`).toBe(theme.get(`--text-${name}--letter-spacing`));
      expect(FAMILIES, `${name} family`).toContain(token.fontFamily);
    }
  });

  it("maps every radius step", () => {
    expect(Object.keys(design.rounded).sort()).toEqual(RADII.map((key) => key.slice(9)).sort());
    for (const [name, value] of Object.entries(design.rounded)) {
      expect(value, `rounded.${name}`).toBe(theme.get(`--radius-${name}`));
    }
  });
});
