import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Mobile horizontal-overflow regression (issue #1486).
 *
 * Live verification (2026-09-05, 390px viewport against https://0509.io):
 *   documentElement.scrollWidth === clientWidth === 390  (overflow 0)
 *   .ld-ticker rect left=0 right=390 width=390  (clipped to the viewport)
 *   .ld-ticker-belt internal scrollWidth = 2829, fully contained by the
 *   clipping container — it does NOT inflate the document scroll width.
 *
 * This repository's node vitest suite has no jsdom/layout engine, so a
 * rendered `scrollWidth === clientWidth` assertion here would be trivially
 * true and prove nothing. The no-horizontal-scroll contract is enforced
 * against a real browser by the existing release e2e
 * (`e2e/home-hero-viewport.spec.ts` → `expectNoHorizontalOverflow`) and the
 * bet9 first-viewport canary. This test instead locks the CSS mechanism that
 * makes that contract hold: the `.ld-ticker` container must keep the
 * `width: max-content` marquee belt from inflating the page width.
 *
 * Failure mode locked: if a future change strips `overflow: hidden`,
 * `contain: inline-size` or `max-width: 100%` from `.ld-ticker` (or changes
 * `.ld-ticker-belt` away from `width: max-content`), the marquee belt leaks
 * 2px of horizontal overflow on 390px viewports and regresses the design
 * ratchet. This test fails on that diff.
 */

const appCss = readFileSync("app/app.css", "utf8");

/** Extract the body of the first top-level CSS rule block for `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped} \\{[\\s\\S]*?\\n\\}`, "m").exec(appCss);
  expect(
    match,
    `expected a top-level CSS rule for \`${selector}\` in app/app.css`,
  ).not.toBeNull();
  return match![0];
}

describe("mobile ticker overflow (issue #1486)", () => {
  it("bounds the ld-ticker container so the marquee belt cannot widen the page at 390px", () => {
    const ticker = ruleBody(".ld-ticker");
    // `overflow: hidden` clips the belt to the container box.
    expect(ticker).toMatch(/overflow:\s*hidden/);
    // `max-width: 100%` stops the container from exceeding its parent.
    expect(ticker).toMatch(/max-width:\s*100%/);
    // `contain: inline-size` sizes the container independently of the
    // `width: max-content` belt, so the belt cannot inflate the document.
    expect(ticker).toMatch(/contain:\s*inline-size/);
  });

  it("keeps the belt a max-content marquee so it animates, but only inside the clipped container", () => {
    const belt = ruleBody(".ld-ticker-belt");
    // The belt must remain `width: max-content` for the ld-roll marquee to
    // glide; containment on the container, not a smaller belt, is the fix.
    expect(belt).toMatch(/width:\s*max-content/);
    // It must not itself become a horizontal scroll bar on the page.
    expect(belt).not.toMatch(/overflow-x\s*:\s*auto|overflow\s*:\s*auto/);
  });

  it("keeps the ticker decorative (aria-hidden) with unchanged motion", () => {
    // The marquee animation is preserved (issue accept criterion 3).
    expect(appCss).toMatch(/@keyframes\s+ld-roll/);
    expect(appCss).toMatch(/\.ld-ticker-belt\s*\{[\s\S]*?animation:\s*ld-roll/);
  });
});
