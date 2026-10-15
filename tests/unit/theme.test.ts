import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function ascii(s: string): string {
  return s.replaceAll("\u2212", "-");
}

function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n## ${heading}`);
  if (start === -1) throw new Error(`DESIGN.md has no section "${heading}"`);
  const rest = doc.slice(start + 1);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

function tableRows(sectionText: string, valueTest: (cell: string) => boolean): { name: string; cells: string[] }[] {
  return sectionText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => ascii(cell.trim().replaceAll("`", ""))),
    )
    .filter((cells) => cells.length >= 2 && cells[0].length > 0 && valueTest(cells[1]))
    .map((cells) => ({ name: cells[0].replace(/^--/, ""), cells }));
}

const isHex = (cell: string) => /^#[0-9a-f]{3,8}$/i.test(cell);
const isTypeSize = (cell: string) => /^(?:clamp\([^)]*\)|[0-9.]+rem)$/.test(cell);
const isDuration = (cell: string) => /^\d+ms(?:\s*\/\s*\d+ms)?$/.test(cell);

function declarationsIn(css: string, selectorMatches: (selector: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();

  function matchingBrace(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function record(slice: string, sink: Map<string, string>): void {
    const decl = slice.trim();
    const colon = decl.indexOf(":");
    if (!decl.startsWith("--") || colon <= 0) return;
    const value = decl.slice(colon + 1).trim();

    if (value) sink.set(decl.slice(0, colon).trim(), value);
  }

  function collect(body: string, sink: Map<string, string>): void {
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= body.length; i++) {
      if (i === body.length) {
        record(body.slice(start, i), sink);
        return;
      }
      if (body[i] === "{") depth++;
      else if (body[i] === "}") depth--;
      else if (body[i] === ";" && depth === 0) {
        record(body.slice(start, i), sink);
        start = i + 1;
      }
    }
  }

  function scan(text: string, inheritedMatch: boolean): void {
    let cursor = 0;
    while (cursor < text.length) {
      const open = text.indexOf("{", cursor);
      if (open === -1) return;
      const close = matchingBrace(text, open);
      if (close === -1) return;
      const selector = text.slice(cursor, open).trim();
      const body = text.slice(open + 1, close);
      const matched = inheritedMatch || selectorMatches(selector);
      if (matched) collect(body, out);
      scan(body, matched);
      cursor = close + 1;
    }
  }

  scan(css, false);
  return out;
}

async function compileAppCss(): Promise<string> {
  const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
  const compiledCss = await compile(css, {
    base: REPO_ROOT,

    loadStylesheet: async () => {
      const resolved = path.join(REPO_ROOT, "node_modules", "tailwindcss", "index.css");
      return { path: resolved, base: path.dirname(resolved), content: await readFile(resolved, "utf8") };
    },
  });
  return compiledCss.build([
    ...[
      "bone",
      "card",
      "ink",
      "ink-soft",
      "ink-faint",
      "line",
      "green",
      "green-ink",
      "green-wash",
      "red",
      "on-green",
    ].flatMap((token) => [`bg-${token}`, `text-${token}`, `border-${token}`]),
    ...[
      "display-1",
      "display-2",
      "display-3",
      "mark-lg",
      "mark-md",
      "mark-sm",
      "title",
      "row-name",
      "body",
      "body-sm",
      "eyebrow",
      "pill",
      "meta",
    ].map((token) => `text-${token}`),
    "ease-push",
    "ease-fade",
    "duration-push",
    "duration-sheet-up",
    "duration-sheet-down",
    "duration-row",
    "duration-switch",
    "duration-fade",
    "duration-press",
    "font-display",
    "font-sans",
    "font-mono",
    "rounded-none",
  ]);
}

const doc = await readFile(path.join(REPO_ROOT, "DESIGN.md"), "utf8");
const typeRows = tableRows(section(doc, "3. Typography"), isTypeSize);

const colourSection = section(doc, "4. Colour");
const colourLightStart = colourSection.indexOf("### Light (default)");
const colourDarkStart = colourSection.indexOf("### Dark");
const lightColourRows = tableRows(colourSection.slice(colourLightStart, colourDarkStart), isHex);
const darkColourRows = tableRows(colourSection.slice(colourDarkStart), isHex);

const compiled = await compileAppCss();
const rootDecls = declarationsIn(compiled, (s) => s === ":root" || s === ":root, :host");

const darkMediaDecls = declarationsIn(
  compiled,
  (s) =>
    (s.startsWith("@media") && s.includes("prefers-color-scheme: dark")) ||
    (s.includes(':not([data-theme="light"])') && s.includes(":root")),
);
const darkAttrDecls = declarationsIn(compiled, (s) => s.includes('[data-theme="dark"]'));

describe("DESIGN.md is parseable by this test (#3984)", () => {
  it("reads §3's type-scale table", () => {
    expect(typeRows.map((r) => r.name)).toEqual([
      "display-1",
      "display-2",
      "display-3",
      "mark-lg",
      "mark-md",
      "mark-sm",
      "title",
      "row-name",
      "body",
      "body-sm",
      "eyebrow",
      "pill",
      "meta",
    ]);
  });

  it("reads §4's light and dark colour tables", () => {
    expect(colourLightStart).toBeGreaterThan(-1);
    expect(colourDarkStart).toBeGreaterThan(colourLightStart);
    const names = lightColourRows.map((r) => r.name);
    expect(names).toEqual([
      "bone",
      "card",
      "ink",
      "ink-soft",
      "ink-faint",
      "line",
      "green",
      "green-ink",
      "green-wash",
      "red",
      "on-green",
    ]);
    expect(darkColourRows.map((r) => r.name)).toEqual(names);
  });
});

describe("colour tokens resolve to DESIGN.md §4 (#3984)", () => {
  it.each(lightColourRows)("$name is the light value", ({ name, cells }) => {
    expect(rootDecls.get(`--${name}`), `--${name} is absent from the compiled :root`).toBe(
      (cells[1] as string).toLowerCase(),
    );
  });

  it.each(darkColourRows)("$name is the dark value under both dark selectors", ({ name, cells }) => {
    const documented = (cells[1] as string).toLowerCase();
    expect(darkMediaDecls.get(`--${name}`), `--${name} missing from @media (prefers-color-scheme: dark)`).toBe(
      documented,
    );
    expect(darkAttrDecls.get(`--${name}`), `--${name} missing from :root[data-theme="dark"]`).toBe(documented);
  });

  it("declares the full dark set under BOTH selectors §4 names", () => {
    expect(darkMediaDecls.size).toBe(lightColourRows.length);
    expect(darkAttrDecls.size).toBe(lightColourRows.length);
  });

  it("gives every token a tailwind utility resolving to the same variable", () => {
    for (const { name } of lightColourRows) {
      const alias = `--color-${name}`;
      expect(compiled, `no .bg-${name} utility resolving through ${alias}`).toMatch(
        new RegExp(`\\.bg-${name}\\s*\\{[^}]*background-color:\\s*var\\(${alias}\\)`),
      );
      expect(compiled, `${alias} does not resolve to var(--${name})`).toContain(`${alias}: var(--${name});`);
    }
  });
});

describe("type-scale tokens resolve to DESIGN.md §3 (#3984)", () => {
  it.each(typeRows)("$name keeps its documented size, line height and tracking", ({ name, cells }) => {
    const [, size, lineHeight, tracking] = cells;

    expect(compiled).toContain(`--text-${name}: ${size};`);
    expect(compiled).toContain(`--text-${name}--line-height: ${lineHeight};`);
    expect(compiled).toContain(`--text-${name}--letter-spacing: ${tracking};`);
  });

  it("keeps the zero tracking §3 gives body and body-sm as a declaration", () => {
    for (const name of ["body", "body-sm"]) {
      expect(compiled).toContain(`--text-${name}--letter-spacing: 0;`);
    }
  });
});

function curves(sectionText: string): Map<string, string> {
  const rows = tableRows(sectionText, isDuration);
  const out = new Map<string, string>();
  let carried = "";
  for (const { name, cells } of rows) {
    const curve = cells[2] ?? "";
    carried = curve === "same" ? carried : normaliseCurve(curve);
    out.set(name, carried);
  }
  return out;
}

function normaliseCurve(curve: string): string {
  return curve
    .replace(/,\s*/g, ", ")
    .replace(/(^|[^\d])\.(\d)/g, (_match, before: string, digit: string) => `${before}0.${digit}`);
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
describe("motion tokens resolve to DESIGN.md §9 (#3984)", () => {
  const documented = new Map(
    tableRows(section(doc, "9. Motion budget"), isDuration).map((r) => [r.name, r.cells[1]] as const),
  );
  const documentedCurves = curves(section(doc, "9. Motion budget"));

  const durations = new Map([
    ["Push (navigate into a brand)", "--duration-push"],
    ["Sheet up / down", "--duration-sheet-up"],
    ["Row expand in place (height + fade)", "--duration-row"],
    ["Switch thumb and track", "--duration-switch"],
    ["Fade in of an arriving field or row", "--duration-fade"],
    ["Button press", "--duration-press"],
  ] as const);

  it("names the same six motions §9 lists, and no seventh", () => {
    expect([...documented.keys()].sort()).toEqual([...durations.keys()].sort());
  });

  it.each([...durations])("%s carries its documented duration", (motionName, token) => {
    const documentedMs = /(\d+)ms/.exec(documented.get(motionName) ?? "")?.[1];
    expect(documentedMs, `§9 has no ms duration for "${motionName}"`).toBeDefined();
    expect(compiled).toContain(`${token}: ${documentedMs}ms;`);
  });

  it("gives every duration the token Tailwind's duration-* utility reads", () => {
    for (const token of durations.values()) {
      expect(compiled).toContain(`--transition-duration-${token.replace("--duration-", "")}: var(${token});`);
      const utility = token.replace("--duration-", "");

      expect(compiled, `no .duration-${utility} rule`).toMatch(new RegExp(`\\.duration-${utility}\\s*\\{`));
      expect(compiled, `no .duration-${utility} rule using the --transition-duration-* name`).toMatch(
        new RegExp(
          `\\.duration-${utility}\\s*\\{[^}]*transition-duration:\\s*var\\(--transition-duration-${utility}\\)`,
        ),
      );
    }

    const fade = "--ease-fade";
    const push = "--ease-push";
    const fadeCurve = documentedCurves.get("Fade in of an arriving field or row");
    const pushCurve = documentedCurves.get("Push (navigate into a brand)");
    expect(fadeCurve, "§9 gives the fade no curve").toBeDefined();
    expect(pushCurve, "§9 gives the push no curve").toBeDefined();
    expect(compiled).toContain(`${push}: ${pushCurve};`);
    expect(compiled).toContain(`${fade}: ${fadeCurve};`);

    expect(compiled.match(new RegExp(`--ease-push:\\s*${escapeRe(pushCurve ?? "")}`, "g"))?.length).toBe(1);
  });

  it("declares the sheet-down duration §9 gives its own number", () => {
    const pair = /(\d+)ms\s*\/\s*(\d+)ms/.exec(documented.get("Sheet up / down") ?? "");
    expect(pair, "§9's sheet row no longer gives an up / down pair").not.toBeNull();
    const down = pair?.[2];
    expect(compiled).toContain(`--duration-sheet-down: ${down}ms;`);
  });

  it("disables every transition and animation under prefers-reduced-motion", () => {
    const start = compiled.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start, "no prefers-reduced-motion block in app/app.css").toBeGreaterThan(-1);
    const end = compiled.indexOf("@property", start);
    const reduced = compiled.slice(start, end === -1 ? undefined : end);
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toContain("transition: none !important");

    expect(reduced).toContain("*, *::before, *::after");
  });
});

describe("the one stylesheet stays the one stylesheet (#3984)", () => {
  it("has no tailwind config theme that could drift from app/app.css", async () => {
    for (const name of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]) {
      await expect(readFile(path.join(REPO_ROOT, name), "utf8")).rejects.toThrow();
    }
  });

  it("declares no @apply component class", async () => {
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
    expect(css).not.toContain("@apply");
  });

  it("carries no comment justifying a workaround", async () => {
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
    expect(css).not.toContain("/*");
    expect(css).not.toContain("//");
  });

  it("carries no second vocabulary for a §4 colour", async () => {
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
    for (const legacy of [
      "--color-accent",
      "--color-accent-ink",
      "--color-accent-wash",
      "--color-strike",
      "--color-on-accent",
    ]) {
      expect(css, `${legacy} is a second name for a §4 colour`).not.toContain(legacy);
    }
  });

  it("self-hosts the three faces with font-display: swap and no Google link", async () => {
    const css = await readFile(path.join(REPO_ROOT, "public/app-faces.css"), "utf8");
    for (const family of ["Bricolage Grotesque", "Instrument Sans", "IBM Plex Mono"]) {
      expect(css).toContain(`font-family: "${family}"`);
    }
    for (const file of [
      "bricolage-hero.woff2",
      "bricolage-grotesque-latin.woff2",
      "instrument-sans-latin.woff2",
      "ibm-plex-mono-latin-400.woff2",
      "ibm-plex-mono-latin-500.woff2",
    ]) {
      expect(css, `${file} is not self-hosted`).toContain(`/fonts/${file}`);
    }

    const faces = css.split("@font-face").slice(1);
    expect(faces.length).toBeGreaterThanOrEqual(3);
    for (const face of faces) {
      expect(face.slice(0, face.indexOf("}"))).toContain("font-display: swap");
    }
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("fonts.gstatic.com");
  });

  it("keeps radius 0", async () => {
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
    expect(css).toContain("--radius-none: 0px");
    expect(css).not.toMatch(/border-radius:\s*(?:0\.[0-9]|[1-9])/);
  });

  it("zeroes every step of the radius scale, not just --radius-none", async () => {
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
    for (const step of ["none", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"]) {
      expect(css, `--radius-${step} is not 0`).toContain(`--radius-${step}: 0px`);
    }
  });

  it("maps every shadcn stock colour token onto a documented one", async () => {
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
    const aliases: Record<string, string> = {
      "--color-background": "--bone",
      "--color-foreground": "--ink",
      "--color-card": "--card",
      "--color-popover": "--card",
      "--color-popover-foreground": "--ink",
      "--color-primary": "--green",
      "--color-primary-foreground": "--on-green",
      "--color-secondary": "--bone",
      "--color-secondary-foreground": "--ink",
      "--color-muted": "--bone",
      "--color-muted-foreground": "--ink-soft",
      "--color-destructive": "--red",
      "--color-border": "--line",
      "--color-input": "--line",
      "--color-ring": "--ink",
    };
    for (const [stock, house] of Object.entries(aliases)) {
      expect(css, `${stock} does not alias ${house}`).toContain(`${stock}: var(${house})`);
      expect(css, `${house} is aliased but never declared`).toMatch(new RegExp(`^\\s*${house}:\\s*#`, "m"));
    }
  });

  it("wires the token names into root.tsx's font preload links", async () => {
    const root = await readFile(path.join(REPO_ROOT, "app/root.tsx"), "utf8");
    expect(root).toContain("bricolage-hero.woff2");
    expect(root).toContain("instrument-sans-latin.woff2");
    expect(root).not.toContain("fonts.googleapis.com");
    expect(root).not.toContain("fonts.gstatic.com");
  });
});
