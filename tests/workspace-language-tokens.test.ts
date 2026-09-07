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

  it("spends Bricolage on titles and entity names only", () => {
    const section = stripComments(layer());
    const displayRules = [...section.matchAll(/([^{}]+)\{[^}]*var\(--ld-display\)[^}]*\}/g)].map(
      (match) => match[1].trim().replace(/\s+/g, " "),
    );
    expect(displayRules.sort()).toEqual([
      ".f9-access-key-name",
      ".f9-acct-entity",
      ".f9-library-entity-title",
      ".f9-library-switch-item",
      ".f9-wk-avatar",
      ".f9-wk-detail-name",
      ".f9-wk-entity",
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

describe("the coexistence seam inside a rebuilt page (BL-030 round 2)", () => {
  /**
   * A rebuilt page may still host an Evidence Desk component whose phase has
   * not landed. Round 1 scoped down its rule weight and its shadow but left
   * its green and its caps-mono alone, and then reported the page as "one
   * green mark" using a probe that only counted this layer's own class. The
   * budget is the page's, not the layer's.
   */
  /**
   * NOTE: this case proves the seam's INVENTORY of accent rules — that exactly
   * one rule in the scoped layer reaches for green. It cannot prove that rule
   * matches a real node; round 3 shipped a selector that matched nothing and
   * this shape of assertion passed anyway. `tests/event-change-green-mark.test.tsx`
   * is the one that renders the tree and fails when the wiring breaks.
   */
  it("spends no green on the setup card inside a rebuilt page", () => {
    const section = stripComments(layer());
    const scoped = section.slice(section.indexOf(".f9-wk-page .f9-evidence-cta {"));
    expect(scoped).toContain(".f9-wk-page .f9-evidence-setup-stamp");
    expect(scoped).toContain(".f9-wk-page .f9-evidence-cta--rank3");
    // Rank 3's accent underline and the step stamps are the two green
    // moments that used to sit beside the Overnight mark.
    expect(scoped).toMatch(
      /\.f9-wk-page \.f9-evidence-cta--rank3 \{[^}]*text-decoration-color: currentColor/,
    );
    for (const selector of [
      ".f9-wk-page .f9-evidence-setup-stamp",
      '.f9-wk-page .f9-evidence-setup-row[data-state="done"] .f9-evidence-setup-stamp',
      '.f9-wk-page .f9-evidence-setup-row[data-state="next"] .f9-evidence-setup-stamp',
    ]) {
      const block = scoped.slice(scoped.indexOf(`${selector} {`));
      expect(block.slice(0, block.indexOf("}"))).not.toMatch(/green/);
    }
    // Each rebuilt surface may reach for the accent in exactly one
    // structurally newest announcement. These selectors cannot coexist in
    // one view: the first belongs to the Competitors record, the second to
    // the Briefs reader. Their paint-real tests resolve both against live
    // markup, and the capture harness enforces the per-viewport budget.
    const accentRules = [...scoped.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , body]) => /--green\b|--ed-accent\b/.test(body))
      .map(([, selector]) => selector.trim().replace(/\s+/g, " "));
    expect(accentRules).toEqual([
      ".f9-wk-page .f9-evidence-diff-plate.is-newest .f9-evidence-diff-value mark",
      ".f9-wk-brief-announcement.is-newest .f9-wk-ins",
    ]);
    // And the default for every other plate's token is the sunk ground.
    expect(scoped).toMatch(
      /\.f9-wk-page \.f9-evidence-diff-value mark \{[^}]*background: var\(--wk-sunk\)/,
    );
  });

  it("keeps the caps-mono budget to the page's own three kickers", () => {
    const section = stripComments(layer());
    const scoped = section.slice(section.indexOf(".f9-wk-page .f9-evidence-cta {"));
    // The setup card shipped a fourth and fifth caps-mono surface: its
    // "SETUP · N OF 4 DONE" kicker and its DONE / NEXT / PENDING stamps.
    for (const selector of [
      ".f9-wk-page .f9-evidence-setup-stamp",
      ".f9-wk-page .f9-evidence-setup-header .f9-evidence-micro",
    ]) {
      const block = scoped.slice(scoped.indexOf(`${selector} {`));
      const body = block.slice(0, block.indexOf("}"));
      expect(body).toContain("text-transform: none;");
      expect(body).toContain("font-family: var(--f9-font);");
      expect(body).toContain("letter-spacing: 0;");
    }

    // BL-035 closes the remaining ledger item: the setup card's useful
    // capacity/alternate-path links remain, but no longer spend caps-mono.
    for (const selector of [
      ".f9-wk-page .f9-evidence-setup-links .f9-evidence-cta--rank3",
      ".f9-wk-page .f9-evidence-setup-capacity .f9-evidence-cta--rank3",
    ]) {
      const block = scoped.slice(scoped.indexOf(selector));
      const body = block.slice(0, block.indexOf("}"));
      expect(body).toContain("text-transform: none;");
      expect(body).toContain("font-family: var(--f9-font);");
      expect(body).toContain("letter-spacing: 0;");
    }
  });
});
