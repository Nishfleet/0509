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
/**
 * BL-030 appended a second, independent design layer to app.css. The
 * Evidence Desk section is now bounded on both sides — its rules end where
 * the workspace-language layer begins. `tests/workspace-language-tokens.test.ts`
 * holds that layer to its own (different) contract.
 */
const WORKSPACE_LANGUAGE_MARKER =
  "BL-030 — the landing-language workspace layer (2026-07-29)";

function evidenceDeskSection(source: string): string {
  const start = source.indexOf(PRIMITIVES_MARKER);
  const end = source.indexOf(WORKSPACE_LANGUAGE_MARKER);
  return end > start ? source.slice(start, end) : source.slice(start);
}

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

/**
 * Comments are documentation, not declarations — a note explaining why
 * `border-radius: 6px` from the app-wide focus rule is a problem must not
 * register as a 6px radius, and a note quoting a hex contrast ratio must not
 * register as a hardcoded hex.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

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
    const section = stripComments(evidenceDeskSection(css));
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
    const section = stripComments(evidenceDeskSection(css));
    expect(section).toContain("border-radius: 0;");
    expect(section).toContain("border: 2.5px solid var(--ed-rule);");
    // Catches every non-zero form, including `0px`, `.5rem` and `var(--x)`.
    // Matching the whole declaration avoids the backtracking hole a bare
    // `\s*(?!0…)` lookahead leaves open.
    const radii = [...section.matchAll(/border-radius:\s*([^;]+);/g)].map((match) =>
      match[1].trim(),
    );
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.filter((value) => value !== "0")).toEqual([]);
  });

  it("pauses the specimen scan line under prefers-reduced-motion (brief §11)", () => {
    const section = evidenceDeskSection(css);
    expect(section).toContain("@media (prefers-reduced-motion: reduce)");
    expect(section).toContain(".f9-evidence-specimen-scan {\n    animation: none;");
  });

  it("keeps every CTA rank at a 44px touch target (brief §9.6)", () => {
    const section = evidenceDeskSection(css);
    const cta = section.slice(section.indexOf(".f9-evidence-cta {"), section.indexOf(".f9-evidence-status-strip {"));
    expect(cta).toContain("min-height: 44px;");
    expect(cta.match(/min-height: 44px;/g)?.length).toBeGreaterThanOrEqual(2);
    // Focus is visible and is NOT the offset shadow (brief §10).
    expect(cta).toContain(".f9-evidence-cta:focus-visible");
    expect(cta).toContain("outline: 2.5px solid var(--ed-focus);");
    // The app-wide `button:focus-visible` rule ships `border-radius: 6px` at
    // (0,1,1) and outranks `.f9-evidence-cta` at (0,1,0), so the focus rule must
    // restate square corners or every CTA rounds itself on focus.
    const focusRule = cta.slice(
      cta.indexOf(".f9-evidence-cta:focus-visible {"),
      cta.indexOf("}", cta.indexOf(".f9-evidence-cta:focus-visible {")),
    );
    expect(focusRule).toContain("border-radius: 0;");
    // Every rank gives hover feedback too, so focus is not the only signal.
    expect(cta).toContain(".f9-evidence-cta--rank1:hover");
    expect(cta).toContain(".f9-evidence-cta--rank2:hover");
    expect(cta).toContain(".f9-evidence-cta--rank3:hover");
  });

  it("never paints a focus ring in the marker accent, which cannot reach 3:1", () => {
    // --ed-accent (#16c47f) is 2.01:1 on bone and 2.16:1 on card: legal as a
    // fill or a marker, illegal as a non-text UI boundary (WCAG 1.4.11).
    // --ed-focus resolves to --green-ink, which flips with the theme.
    expect(css).toContain("--ed-focus: var(--green-ink);");
    const section = evidenceDeskSection(css);
    const focusRules = section.split("\n").filter((line) => line.includes("outline:"));
    expect(focusRules.length).toBeGreaterThan(0);
    for (const rule of focusRules) {
      expect(rule).not.toContain("var(--ed-accent)");
    }
  });

  it("drops the offset shadows in the Plain volume (brief §3)", () => {
    const section = evidenceDeskSection(css);
    expect(section).toContain('[data-wk-volume="plain"] .f9-evidence-cta--rank1');
    expect(section).toContain('[data-wk-volume="plain"] .f9-evidence-diff-plate');
    // Hover states are shadows too: every rule that paints an offset shadow
    // needs a Plain-volume counterpart, or the suppression list quietly rots.
    const suppressed = section.slice(
      section.indexOf('[data-wk-volume="plain"]'),
      section.indexOf("}", section.indexOf('[data-wk-volume="plain"]')),
    );
    const shadowRules = section
      .split("\n")
      .filter((line) => /^\.f9-evidence-cta--rank[12]:hover/.test(line.trim()))
      .map((line) => line.trim().replace(" {", ""));
    expect(shadowRules.length).toBeGreaterThan(0);
    for (const rule of shadowRules) {
      expect(suppressed).toContain(`[data-wk-volume="plain"] ${rule}`);
    }
  });
});
