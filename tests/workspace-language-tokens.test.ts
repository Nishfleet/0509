import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * BL-030 — the landing-language workspace layer holds its own contract.
 *
 * The program's boringness budget is law: build every surface as if it were
 * Linear, then spend character in exactly four places (Bricolage on the page
 * title and on watched-entity names, one green mark per viewport, radius 0,
 * the three motion curves). v1-v3 of the concept are documented failure
 * modes — busy dashboard, poster, ornament — and every rule below is what
 * stops the layer regressing into one of them.
 */

const css = readFileSync("app/app.css", "utf8");
const MARKER = "BL-030 — the landing-language workspace layer (2026-07-29)";

function layer(): string {
  const index = css.indexOf(MARKER);
  expect(index).toBeGreaterThan(0);
  return css.slice(index);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("workspace language layer (BL-030)", () => {
  it("uses one rule weight on the page, and it is 1px", () => {
    const section = stripComments(layer());
    const widths = new Set<string>();
    for (const match of section.matchAll(
      /border(?:-top|-right|-bottom|-left)?:\s*([^;]+);/g,
    )) {
      const value = match[1].trim();
      if (value === "0") continue;
      const width = value.split(/\s+/)[0];
      widths.add(width);
    }
    for (const match of section.matchAll(
      /border-(?:top|right|bottom|left)-width:\s*([^;]+);/g,
    )) {
      widths.add(match[1].trim());
    }
    expect([...widths].sort()).toEqual(["1px"]);
  });

  it("keeps every radius at 0 — the document signal, not the software one", () => {
    const section = stripComments(layer());
    const radii = [...section.matchAll(/border-radius:\s*([^;]+);/g)].map((match) =>
      match[1].trim(),
    );
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.filter((value) => value !== "0")).toEqual([]);
  });

  it("declares the three motion curves and kills all of them under reduced motion", () => {
    const section = layer();
    expect(section).toContain("--wk-snap: 120ms cubic-bezier(0.2, 0, 0.2, 1);");
    expect(section).toContain("--wk-settle: 260ms cubic-bezier(0.2, 0.7, 0.2, 1);");
    expect(section).toContain("--wk-land: 340ms cubic-bezier(0.2, 0.9, 0.3, 1.06);");

    const reduced = section.slice(section.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("animation: none !important;");
    expect(reduced).toContain("transition: none !important;");
    // Every animated primitive is named in the kill switch. Land in
    // particular is the only overshoot in the system, so it must never
    // survive the preference.
    for (const selector of [".f9-wk-detail", ".f9-wk-strip", ".f9-wk-row", ".f9-wk-tab"]) {
      expect(reduced.slice(0, reduced.indexOf("}"))).toContain(selector);
    }
  });

  it("hover moves colour and rule weight only, never position or scale", () => {
    const section = stripComments(layer());
    const hoverBlocks = [...section.matchAll(/:hover[^{]*\{([^}]*)\}/g)].map(
      (match) => match[1],
    );
    expect(hoverBlocks.length).toBeGreaterThan(0);
    for (const block of hoverBlocks) {
      expect(block).not.toMatch(/transform|translate|scale|box-shadow/);
    }
  });

  it("keeps the rail monochrome — green only ever appears in the work", () => {
    const section = layer();
    const railBlock = section.slice(
      section.indexOf(".f9-dash-page-app .f9-wk-rail {"),
      section.indexOf("/* ---------------------------------------------------------------\n   The working page"),
    );
    expect(railBlock.length).toBeGreaterThan(500);
    // The one sanctioned exception is the focus ring, which must stay visible
    // against the ink band and is a boundary, not a state marker.
    const greenUses = [...railBlock.matchAll(/var\(--green[^)]*\)|#16c47f/gi)];
    expect(greenUses).toHaveLength(0);
  });

  it("spends Bricolage on the page title and watched-entity names only", () => {
    const section = stripComments(layer());
    const displayRules = [...section.matchAll(/([^{}]+)\{[^}]*var\(--ld-display\)[^}]*\}/g)].map(
      (match) => match[1].trim().replace(/\s+/g, " "),
    );
    expect(displayRules.sort()).toEqual([
      ".f9-wk-avatar",
      ".f9-wk-detail-name",
      ".f9-wk-nm",
      ".f9-wk-title",
      ".f9-wk-wordmark",
    ]);
    // A summary row is not a watched entity, so it gives the face back.
    expect(section).toContain(".f9-wk-row.is-plain .f9-wk-nm");
    expect(section).toMatch(
      /\.f9-wk-row\.is-plain \.f9-wk-nm \{[^}]*font-family: var\(--f9-font\)/,
    );
  });

  it("resolves every colour through the workspace tokens except the rail band tones", () => {
    const section = stripComments(layer());
    const hexLines = section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line));
    // The rail is the one genuinely new pigment family in the system; every
    // hex in this layer is one of its band tones, declared once in a token
    // block and never inlined into a rule.
    expect(
      hexLines.every((line) =>
        /^--wk-(band|band-2|on-band|on-band-dim|band-rule|sunk|on-fill):/.test(line),
      ),
    ).toBe(true);
    expect(hexLines.length).toBeGreaterThan(0);
  });

  it("gives the dark theme the cut-deeper rail rather than an inverted one", () => {
    const section = layer();
    const dark = section.slice(
      section.indexOf('[data-f9-theme="dark"] {'),
      section.indexOf("Character 4"),
    );
    expect(dark).toContain("--wk-band: #0d0c09;");
    expect(dark).toContain("--wk-on-band: #ece9e1;");
  });
});
