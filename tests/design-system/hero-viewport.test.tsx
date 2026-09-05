import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression test for the chosen BET 9 hero direction (Safe) — issue #1488.
 *
 * The issue asks for an automated regression test that renders the selected
 * direction at 1440px and 390px and asserts the headline, value proposition,
 * and clickable CTA all sit inside the first viewport, with zero console
 * errors and no horizontal overflow. The chosen direction lives at
 * docs/design/hero-directions/01-safe.html (see CHOSEN.md); this test drives
 * scripts/hero-viewport-verification.mjs, which loads that HTML in Chromium at
 * both termination viewports and prints one PASS/FAIL line per check. The
 * spawn-and-assert-on-output pattern mirrors tests/design-system-ratchet.test.ts
 * driving scripts/design-system-ratchet.mjs.
 */
const root = join(__dirname, "..", "..");
const script = join(root, "scripts", "hero-viewport-verification.mjs");
const heroHtml = join(
  root,
  "docs",
  "design",
  "hero-directions",
  "01-safe.html",
);

describe("chosen hero direction (Safe) first-viewport regression — #1488", () => {
  it("the three direction HTML files exist", () => {
    expect(existsSync(heroHtml), `missing ${heroHtml}`).toBe(true);
    expect(
      existsSync(join(root, "docs", "design", "hero-directions", "02-bold.html")),
    ).toBe(true);
    expect(
      existsSync(
        join(root, "docs", "design", "hero-directions", "03-weird-but-plausible.html"),
      ),
    ).toBe(true);
  });

  it("renders Safe at 1440px and 390px with headline, value prop, CTA in fold, no overflow, zero console errors", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    const out = result.stdout + result.stderr;
    expect(result.status, out).toBe(0);
    expect(out).toContain("Termination: PASS");

    // Desktop 1440x900
    expect(out).toContain("PASS desktop headline_in_first_viewport");
    expect(out).toContain("PASS desktop value_proposition_in_first_viewport");
    expect(out).toContain("PASS desktop cta_in_first_viewport");
    expect(out).toContain("PASS desktop cta_clickable");
    expect(out).toContain("PASS desktop no_horizontal_scroll");
    expect(out).toContain("PASS desktop no_nested_overflow_in_first_viewport");
    expect(out).toContain("PASS desktop zero_console_errors");

    // Mobile 390x844
    expect(out).toContain("PASS mobile headline_in_first_viewport");
    expect(out).toContain("PASS mobile value_proposition_in_first_viewport");
    expect(out).toContain("PASS mobile cta_in_first_viewport");
    expect(out).toContain("PASS mobile cta_clickable");
    expect(out).toContain("PASS mobile no_horizontal_scroll");
    expect(out).toContain("PASS mobile no_nested_overflow_in_first_viewport");
    expect(out).toContain("PASS mobile zero_console_errors");
  });
});
