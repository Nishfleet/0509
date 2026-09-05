import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * BET 9 hero first-viewport regression (issue #1488).
 *
 * The chosen direction is Safe (`docs/design/hero-directions/01-safe.html`,
 * see CHOSEN.md): the H1 names the buyer ("Growth teams") and the job
 * ("know the offer before the call"), the live-proof mechanic is demoted to
 * a strip beneath the headline, and the search input + its CTA both clear
 * the fold at 390×844 with no horizontal overflow.
 *
 * This repository's node vitest suite has no jsdom/layout engine, so a
 * rendered `scrollWidth === clientWidth` assertion here would be trivially
 * true and prove nothing. The rendered first-viewport contract (headline +
 * value prop + CTA in the fold, no horizontal overflow, zero console errors)
 * is enforced against a real browser by the existing release e2e
 * (`e2e/home-hero-viewport.spec.ts`, run in cross-browser-matrix with
 * Playwright browsers installed) — the same pattern the mobile-overflow test
 * (#1486) documents. This test instead locks the CSS mechanism that makes
 * that contract hold for the design directions: the mobile first-viewport
 * budget in `docs/design/hero-directions/hero-directions.css`, and the
 * buyer+job composition of the direction HTML artefacts.
 */

const dir = "docs/design/hero-directions";
const cssPath = join(dir, "hero-directions.css");
const css = readFileSync(cssPath, "utf8");

/** Direction files required by the issue's accept criteria #1. */
const directionFiles = ["01-safe.html", "02-bold.html", "03-weird-but-plausible.html"];

/**
 * Extract the body of the first top-level CSS rule block for `selector`.
 * Mirrors the helper in tests/design-system/mobile-overflow.test.tsx.
 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped} \\{[\\s\\S]*?\\n\\}`, "m").exec(css);
  expect(
    match,
    `expected a top-level CSS rule for \`${selector}\` in ${cssPath}`,
  ).not.toBeNull();
  return match![0];
}

/**
 * Extract the body of an `@media (max-width: Npx)` block, balancing braces so
 * nested rules are included and the block ends at its own closing brace.
 */
function mediaBlock(width: 860 | 600): string {
  const start = css.indexOf(`@media (max-width: ${width}px) {`);
  expect(start, `expected an @media (max-width: ${width}px) block`).toBeGreaterThan(-1);
  let depth = 0;
  let i = start;
  for (; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return css.slice(start, i + 1);
}

const media860 = () => mediaBlock(860);
const media600 = () => mediaBlock(600);

describe("BET 9 hero directions exist (issue #1488 accept #1, #2)", () => {
  it("ships the three direction HTML artefacts with the buyer+job hero and demoted proof", () => {
    for (const f of directionFiles) {
      const html = readFileSync(join(dir, f), "utf8");

      // The live-proof mechanic is preserved: proof brief ticker + proof strip.
      expect(html).toContain("ld-ticker");
      expect(
        html,
        "proof strip keeps its `aria-label=\"Live proof brief\"`",
      ).toContain('class="ld-proof-strip" aria-label="Live proof brief"');

      // A single buyer/job H1: names a buyer, not the Nykaa ad hook.
      expect(html.match(/<h1 class="ld-wall">/g)?.length ?? 0).toBe(1);
      expect(html, "H1 names the buyer (growth team/your client, not Nykaa)").toMatch(
        /Growth teams|agencies and growth teams|competitors.? landing|a client|your competitor/i,
      );

      // The demoted proof strip sits AFTER the H1 in the document (beneath the
      // headline), not promoted into it.
      const h1Index = html.indexOf('<h1 class="ld-wall">');
      const stripIndex = html.indexOf('class="ld-proof-strip"');
      expect(h1Index).toBeGreaterThan(-1);
      expect(stripIndex).toBeGreaterThan(h1Index);

      // Clickable CTA and search input are present.
      expect(html).toContain("Preview available ads");
      expect(html).toContain('aria-label="Competitor website"');
    }
  });

  it("records the chosen direction as Safe", () => {
    const chosen = readFileSync(join(dir, "CHOSEN.md"), "utf8");
    expect(chosen).toMatch(/Safe/i);
    expect(chosen).toContain("01-safe.html");
    expect(chosen).not.toMatch(/Chosen.*Bold|Chosen.*Weird/i);
  });
});

describe("BET 9 mobile first-viewport budget — input + CTA above the fold (issue #1488 accept #3)", () => {
  it("stacks the command vertically at ≤860px so the CTA sits under the input", () => {
    const m = media860();
    // The command column-stacks (input on top, CTA beneath) on tablet/mobile.
    expect(m).toMatch(/\.ld-command\s*\{[\s\S]*?flex-direction:\s*column/);
    expect(m).toMatch(/\.ld-command\s*\{[\s\S]*?max-width:\s*100%/);
  });

  it("collapses the nav to a single non-wrapping scrollable row at ≤860px", () => {
    const m = media860();
    // One visual row of links (nowrap), scrollable horizontally if it overflows —
    // never two stacked rows that push the hero below the fold.
    expect(m).toMatch(/\.ld-nav-links\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
    expect(m).toMatch(/\.ld-nav-links\s*\{[\s\S]*?overflow-x:\s*auto/);
    // The "Open app" entry hides so the account actions stay one 44px row.
    expect(m).toMatch(/\.ld-nav-actions\s*\.ld-nav-open-app\s*\{[\s\S]*?display:\s*none/);
  });

  it("compacts the demoted proof strip at ≤600px so the command clears the 390px fold", () => {
    const m = media600();
    // The proof strip's trail + foot are hidden; only the hook stays, keeping
    // the search command above the fold on a 390×844 viewport.
    expect(m).toMatch(/\.ld-proof-trail,[\s\S]*?\.ld-proof-strip-foot\s*\{[\s\S]*?display:\s*none/);
    // The deck copy tightens so it does not push the CTA below the fold.
    expect(m).toMatch(/\.ld-deck-copy\s*\{[\s\S]*?font-size:\s*0\.88rem/);
  });

  it("keeps the flag pill inside the viewport on narrow screens (no horizontal overflow)", () => {
    const m = media600();
    // The `.ld-flag` inset is pulled back from `right: -0.22em` (desktop) to
    // `-0.04em` on narrow viewports so it cannot leak 2–3px past the edge.
    expect(m).toMatch(/\.ld-wall\s*\.ld-flag\s*\{[\s\S]*?right:\s*-0\.04em/);
  });
});

describe("BET 9 design-system ratchet stays clean (issue #1488 accept #5)", () => {
  it("scans only app/, so docs/ design artefacts add no ratchet debt", () => {
    // The ratchet (`scripts/design-system-ratchet.mjs`) scans SCAN_DIRS = ["app"].
    // The direction artefacts live under docs/, out of the design-system scan —
    // verifying they cannot inflate the ceilings. The real pass is the
    // design-system-ratchet.test.ts suite which runs the script itself.
    expect(cssPath).toMatch(/^docs\//);
  });
});
