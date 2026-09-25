import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

// #3984: one stylesheet of colour, type and motion tokens. DESIGN.md is the
// authority; this test reads §3 (type scale), §4 (colour) and §9 (motion) as
// DATA and asserts app/app.css resolves every token they name to the documented
// value in BOTH themes. Parsing the doc rather than restating the values is the
// point — a reworded hex in either file fails here instead of shipping as two
// design systems, which is the drift the issue exists to stop.
//
// This file sits in tests/unit/, one level below the existing tests/*.test.ts,
// so the repo root is two directories up.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// DESIGN.md writes negative tracking with U+2212 MINUS SIGN; CSS uses the ASCII
// hyphen. Comparing the two literally would fail on the character alone, which
// is not the drift this test is for, so the doc side is normalised.
function ascii(s: string): string {
  return s.replaceAll("\u2212", "-");
}

// One parse of DESIGN.md, shared by the suites. `section()` cuts from a heading
// to the next heading of the same level, so a subsection added later cannot
// silently widen it.
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n## ${heading}`);
  if (start === -1) throw new Error(`DESIGN.md has no section "${heading}"`);
  const rest = doc.slice(start + 1);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

// A DESIGN.md table row is `| name | value | ... |`. The row's own value cell is
// the unambiguous discriminator: §3's sizes are a rem or a clamp, §4's colours
// are a hex, §9's durations are ms. Matching the value rather than the name
// keeps out the header row (`| Token | Value |`) and the alignment row
// (`|---|---|`), neither of which holds a CSS value anywhere.
//
// The name is returned with whatever prefix the section uses — §4 writes
// `--bone`, §3 and §9 write bare `display-1` / `Push` — stripped, so the colour
// suite re-adds `--` and the others know not to.
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

// A tiny, deliberate CSS block scanner. Tailwind nests the dark values inside
// the media query, so a flat `{...}{...}` regex never finds them; this matches a
// selector and then walks into its body. Returns only top-level custom-property
// declarations, ignoring the nested rules it descends through.
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
    // A value is required; `--x:;` is not a token a browser can use.
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

// Tailwind compiles app/app.css the way the build does, so the assertions are
// about the stylesheet as Tailwind emits it rather than about the source text.
async function compileAppCss(): Promise<string> {
  const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
  const { build } = await compile(css, {
    base: REPO_ROOT,
    // `@import "tailwindcss"` resolves through node_modules exactly as the Vite
    // plugin resolves it; no copy of the package is checked in.
    loadStylesheet: async () => {
      const resolved = path.join(REPO_ROOT, "node_modules", "tailwindcss", "index.css");
      return { path: resolved, base: path.dirname(resolved), content: await readFile(resolved, "utf8") };
    },
  });
  return build([
    // Every utility a token declares, so the output carries them all. The list
    // is explicit on purpose: the served bundle tree-shakes any utility no
    // surface uses, which would make an unused token invisible here — a token
    // whose utility is never generated anywhere is itself a drift.
    ...["bone", "card", "ink", "ink-soft", "ink-faint", "line", "green", "green-ink", "green-wash", "red", "on-green"]
      .flatMap((token) => [`bg-${token}`, `text-${token}`, `border-${token}`]),
    ...["display-1", "display-2", "display-3", "mark-lg", "mark-md", "mark-sm", "title", "row-name", "body", "body-sm", "eyebrow", "pill", "meta"]
      .map((token) => `text-${token}`),
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

// ---------- everything computed once at module scope ----------
// Awaiting inside a `describe` callback is a parse error (that callback is not
// async), and recompiling Tailwind per assertion would be pure waste.

const doc = await readFile(path.join(REPO_ROOT, "DESIGN.md"), "utf8");
const typeRows = tableRows(section(doc, "3. Typography"), isTypeSize);

const colourSection = section(doc, "4. Colour");
const colourLightStart = colourSection.indexOf("### Light (default)");
const colourDarkStart = colourSection.indexOf("### Dark");
const lightColourRows = tableRows(colourSection.slice(colourLightStart, colourDarkStart), isHex);
const darkColourRows = tableRows(colourSection.slice(colourDarkStart), isHex);

const compiled = await compileAppCss();
const rootDecls = declarationsIn(compiled, (s) => s === ":root" || s === ":root, :host");
// The dark media block AND the scoped selector it contains. §4 requires the
// values under `@media (prefers-color-scheme: dark)` scoped to
// `:root:not([data-theme="light"])`; matching both halves is what proves the
// non-scoped variant would not have been enough.
const darkMediaDecls = declarationsIn(
  compiled,
  (s) =>
    (s.startsWith("@media") && s.includes("prefers-color-scheme: dark")) ||
    (s.includes(":not([data-theme=\"light\"])") && s.includes(":root")),
);
const darkAttrDecls = declarationsIn(compiled, (s) => s.includes('[data-theme="dark"]'));

// ---------- the doc itself ----------

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

// ---------- colour: §4 ----------

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
    // One selector alone leaves the other path — the OS setting or the explicit
    // attribute — on light values, which is how two screens drift apart.
    expect(darkMediaDecls.size).toBe(lightColourRows.length);
    expect(darkAttrDecls.size).toBe(lightColourRows.length);
  });

  it("gives every token a tailwind utility resolving to the same variable", () => {
    // The chain is: `bg-green` -> `var(--color-green)` -> `var(--green)`. The
    // utility must not carry a second hex of its own, and the alias must land on
    // the canonical §4 name rather than on anything else. Asserting both halves
    // is what makes this a resolution check rather than a naming check.
    for (const { name } of lightColourRows) {
      const alias = `--color-${name}`;
      expect(compiled, `no .bg-${name} utility resolving through ${alias}`).toMatch(
        new RegExp(`\\.bg-${name}\\s*\\{[^}]*background-color:\\s*var\\(${alias}\\)`),
      );
      expect(compiled, `${alias} does not resolve to var(--${name})`).toContain(`${alias}: var(--${name});`);
    }
  });
});

// ---------- type scale: §3 ----------

describe("type-scale tokens resolve to DESIGN.md §3 (#3984)", () => {
  it.each(typeRows)("$name keeps its documented size, line height and tracking", ({ name, cells }) => {
    const [, size, lineHeight, tracking] = cells;
    // Tailwind's `--text-*` namespace is what makes the token a `text-<name>`
    // utility; the §3 name is the name after the prefix.
    expect(compiled).toContain(`--text-${name}: ${size};`);
    expect(compiled).toContain(`--text-${name}--line-height: ${lineHeight};`);
    expect(compiled).toContain(`--text-${name}--letter-spacing: ${tracking};`);
  });

  it("keeps the zero tracking §3 gives body and body-sm as a declaration", () => {
    // A dropped `letter-spacing: 0` and a present one are different CSS, and the
    // drop is silent — this is the assertion that notices it.
    for (const name of ["body", "body-sm"]) {
      expect(compiled).toContain(`--text-${name}--letter-spacing: 0;`);
    }
  });
});

// ---------- motion: §9 ----------

// §9's table has a Curve column, and it is read as data here — the way the
// duration is. A hardcoded `cubic-bezier(.32, .72, 0, 1)` in this test would
// pass while DESIGN.md moved onto a different curve, which is exactly the
// "token present, value wrong" drift the file exists to catch. `same` means
// the previous row's curve; the row above the first `same` is where it starts.
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

// DESIGN.md writes the curve with spaces after the commas
// (`cubic-bezier(.32,.72,0,1)`) and the strip-backticks step in tableRows has
// already run; the stylesheet is written with spaces. Comparing the two
// literally would fail on formatting alone, so the doc side is normalised to
// the CSS spelling — the same reason `ascii()` exists for the minus sign.
function normaliseCurve(curve: string): string {
  return curve.replace(/,\s*/g, ", ");
}

// A curve used inside `new RegExp` must have its metacharacters escaped, or the
// curly braces and commas read as quantifiers/alternation and the count below
// silently matches the wrong thing.
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
describe("motion tokens resolve to DESIGN.md §9 (#3984)", () => {
  // §9's table names each motion in prose and gives its duration. The map below
  // is the only translation: prose name -> the token that carries the duration.
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
    // The duration is the first number in §9's cell, which for "Sheet up / down"
    // is the up duration the token keeps; the down duration has its own token.
    const documentedMs = /(\d+)ms/.exec(documented.get(motionName) ?? "")?.[1];
    expect(documentedMs, `§9 has no ms duration for "${motionName}"`).toBeDefined();
    expect(compiled).toContain(`${token}: ${documentedMs}ms;`);
  });

  it("gives every duration the token Tailwind's duration-* utility reads", () => {
    // `duration-push` is generated from `--transition-duration-push`, so that
    // name must resolve to the canonical `--duration-push`; a second duration
    // value here would be a motion token nothing documented. Asserting the
    // generated `.duration-push` RULE — the way the colour suite asserts the
    // `.bg-green` rule — proves the utility exists and carries the token,
    // rather than proving a declaration string appears somewhere.
    for (const token of durations.values()) {
      // `--duration-push` -> `push`, so the Tailwind-side name matches the
      // canonical token's own suffix.
      expect(compiled).toContain(`--transition-duration-${token.replace("--duration-", "")}: var(${token});`);
      const utility = token.replace("--duration-", "");
      // The chain the browser walks, and what the rule must actually contain:
      // `.duration-push` -> `--transition-duration-push` -> `--duration-push`.
      // Asserting only the middle declaration string would not prove the
      // utility rule exists at all; asserting only the rule would not prove it
      // reaches the canonical token. Both halves, same as the colour suite.
      expect(compiled, `no .duration-${utility} rule`).toMatch(new RegExp(`\\.duration-${utility}\\s*\\{`));
      expect(compiled, `no .duration-${utility} rule using the --transition-duration-* name`).toMatch(
        new RegExp(`\\.duration-${utility}\\s*\\{[^}]*transition-duration:\\s*var\\(--transition-duration-${utility}\\)`),
      );
    }
    // The fade is what §9 gives `linear`; asserting it is what stops the six
    // motions silently collapsing onto the one curve, which the "one curve"
    // reading of §9 would otherwise invite. Read from the Curve column rather
    // than restated: a doc that starts giving the fade the push curve fails
    // here instead of shipping as two motion systems.
    const fade = "--ease-fade";
    const push = "--ease-push";
    const fadeCurve = documentedCurves.get("Fade in of an arriving field or row");
    const pushCurve = documentedCurves.get("Push (navigate into a brand)");
    expect(fadeCurve, "§9 gives the fade no curve").toBeDefined();
    expect(pushCurve, "§9 gives the push no curve").toBeDefined();
    expect(compiled).toContain(`${push}: ${pushCurve};`);
    expect(compiled).toContain(`${fade}: ${fadeCurve};`);

    // The curve is declared exactly once, in `@theme`. A second copy on `:root`
    // would win at runtime while the two could diverge, and a `toContain`
    // above cannot see that — counting declarations can. `@theme` emits it into
    // `:root` once; a second declaration anywhere is drift.
    expect(compiled.match(new RegExp(`--ease-push:\\s*${escapeRe(pushCurve ?? "")}`, "g"))?.length).toBe(1);
  });

  it("declares the sheet-down duration §9 gives its own number", () => {
    // §9 writes "380ms / 280ms" for sheet up / down; both are tokens, so the
    // second number is asserted separately rather than folded into the first.
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
    // `*`, `*::before`, `*::after` is what makes it "every"; a single-element
    // reset would leave the rest of the product animating.
    expect(reduced).toContain("*, *::before, *::after");
  });
});

// ---------- the one stylesheet, and only one ----------

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
    // CLAUDE.md bans comments in app code, and ESLint only reads .ts/.tsx, so
    // this stylesheet has no lint rule covering it. A comment in app code is
    // where an agent writes the reason a workaround is fine instead of fixing
    // the thing, so the whole of app/app.css carries none, and the reason for
    // each decision lives in the commit that made it.
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
    expect(css).not.toContain("/*");
    expect(css).not.toContain("//");
  });

  it("carries no second vocabulary for a §4 colour", async () => {
    // The pre-#3984 tree shipped the accent as --color-accent/-ink/-wash and the
    // strike as --color-strike/-on-accent. Two names for one colour is the drift
    // this issue closes, so the alias set must stay gone: a re-added
    // `--color-accent` would resolve to the same green today and to a different
    // hex the moment someone edits one of the two. ASSERTING THE NAMES, not the
    // hexes: the hexes are already pinned to §4 above.
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
    for (const legacy of ["--color-accent", "--color-accent-ink", "--color-accent-wash", "--color-strike", "--color-on-accent"]) {
      expect(css, `${legacy} is a second name for a §4 colour`).not.toContain(legacy);
    }
  });

  it("self-hosts the three faces with font-display: swap and no Google link", async () => {
    const css = await readFile(path.join(REPO_ROOT, "app/app.css"), "utf8");
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
    // Every face declares swap; a face without it blocks paint on the fallback.
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

  it("wires the token names into root.tsx's font preload links", async () => {
    const root = await readFile(path.join(REPO_ROOT, "app/root.tsx"), "utf8");
    expect(root).toContain("bricolage-hero.woff2");
    expect(root).toContain("instrument-sans-latin.woff2");
    expect(root).not.toContain("fonts.googleapis.com");
    expect(root).not.toContain("fonts.gstatic.com");
  });
});
