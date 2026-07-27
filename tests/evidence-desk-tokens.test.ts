import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * BL-005 — the token layer is the whole reason the Evidence Desk can flip
 * with the workspace dark theme. Brief §4: every --ed-* value is a semantic
 * alias over --ink / --bone / --card / --line / --green / --red, and no rule
 * in the primitives section carries a hex literal.
 */

const css = readFileSync("app/app.css", "utf8");

const PRIMITIVES_MARKER = "Evidence Desk primitives (BL-005, 2026-07-27)";

const REQUIRED_TOKENS = [
  "--ed-rule",
  "--ed-rule-soft",
  "--ed-rule-dashed",
  "--ed-surface",
  "--ed-surface-sunk",
  "--ed-fill",
  "--ed-on-fill",
  "--ed-accent",
  "--ed-deletion",
  "--ed-shadow",
  "--ed-shadow-lg",
  "--ed-shadow-cta",
] as const;

function edDeclarations(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("--ed-"));
}

describe("Evidence Desk token layer (brief §4)", () => {
  it("declares every token the brief's delta table names", () => {
    for (const token of REQUIRED_TOKENS) {
      expect(css, `${token} should be declared`).toContain(`${token}:`);
    }
  });

  it("never hardcodes a hex in an --ed-* declaration", () => {
    const offenders = edDeclarations(css).filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line));
    expect(offenders).toEqual([]);
  });

  it("never hardcodes a hex anywhere in the primitives section", () => {
    const section = css.slice(css.indexOf(PRIMITIVES_MARKER));
    expect(section.length).toBeGreaterThan(1000);
    const offenders = section
      .split("\n")
      .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line))
      .map((line) => line.trim());
    expect(offenders).toEqual([]);
  });

  it("gives the dark theme the alpha offset shadow the brief requires", () => {
    const darkBlock = css.slice(
      css.indexOf('[data-f9-theme="dark"] {'),
      css.indexOf("--dk-well"),
    );
    expect(darkBlock).toContain("--ed-shadow-ink: color-mix(in srgb, var(--ink) 22%, transparent)");
    // Anything printed ON the accent flips to the dark end of the palette.
    expect(darkBlock).toContain("--ed-on-accent: var(--bone)");
  });

  it("keeps radius at 0 and the structural rule at 2.5px on Evidence Desk surfaces", () => {
    const section = css.slice(css.indexOf(PRIMITIVES_MARKER));
    expect(section).toContain("border-radius: 0;");
    expect(section).toContain("border: 2.5px solid var(--ed-rule);");
    expect(section).not.toMatch(/border-radius:\s*(?!0)[0-9]/);
  });

  it("pauses the specimen scan line under prefers-reduced-motion (brief §11)", () => {
    const section = css.slice(css.indexOf(PRIMITIVES_MARKER));
    expect(section).toContain("@media (prefers-reduced-motion: reduce)");
    expect(section).toContain(".f9-ed-specimen-scan {\n    animation: none;");
  });

  it("keeps every CTA rank at a 44px touch target (brief §9.6)", () => {
    const section = css.slice(css.indexOf(PRIMITIVES_MARKER));
    const cta = section.slice(section.indexOf(".f9-ed-cta {"), section.indexOf(".f9-ed-capture {"));
    expect(cta).toContain("min-height: 44px;");
    expect(cta.match(/min-height: 44px;/g)?.length).toBeGreaterThanOrEqual(2);
    // Focus is visible and is NOT the offset shadow (brief §10).
    expect(cta).toContain(".f9-ed-cta:focus-visible");
    expect(cta).toContain("outline: 2.5px solid var(--ed-accent);");
  });

  it("drops the offset shadows in the Plain volume (brief §3)", () => {
    const section = css.slice(css.indexOf(PRIMITIVES_MARKER));
    expect(section).toContain('[data-ed-volume="plain"] .f9-ed-cta--rank1');
    expect(section).toContain('[data-ed-volume="plain"] .f9-ed-diff-plate');
  });
});
