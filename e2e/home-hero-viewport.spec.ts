import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  expectPrimaryActionAboveFold,
} from "./helpers/release-experience";

/**
 * BET 9 (#1277) — the first viewport names the buyer and the job, keeps the
 * proof mechanic demoted to a strip beneath the H1, and lands the search
 * input + its CTA above the fold on both desktop (1440×900) and mobile
 * (390×844). This spec locks that composition so a future hero change cannot
 * silently push the primary action below the fold or reintroduce the
 * horizontal overflow the ticker/flag pills used to leak.
 *
 * The H1 wording itself is Nish's call (notes-for-worker); this test asserts
 * the buyer+job headline EXISTS and is the single <h1>, not any specific
 * string — so a voice pass does not have to touch this file.
 */
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

// The H1 must name the buyer ("growth teams") and the job (tracking
// competitors / knowing the offer). Both example patterns in the issue and
// the landed "Safe" direction hit this; a generic "watch competitors" line
// would fail the buyer half.
const BUYER_JOB_H1 = /growth teams.*competitor|competitor.*growth teams/i;

for (const viewport of viewports) {
  test(`BET 9 hero: buyer-job H1, proof strip, search input + CTA above the fold (${viewport.name} ${viewport.width}x${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    expect(page.viewportSize()).toEqual({
      width: viewport.width,
      height: viewport.height,
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Let the Bricolage 800 wall and the proof strip settle so bounding boxes
    // match the rendered layout, not a pre-font fallback.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    // One <h1>, naming the buyer and the job.
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();
    await expect(h1).toContainText(BUYER_JOB_H1);

    // The value proposition is present as visible copy (the deck paragraph
    // beneath the proof strip). It must be in the document; the fold check
    // below covers the input/CTA, and the deck sits between H1 and input.
    const deckCopy = page.locator(".ld-deck-copy").first();
    await expect(deckCopy, "value proposition deck copy is present").toBeVisible();
    await expect(deckCopy, "value proposition names what the product watches").toContainText(
      /watches competitors/i,
    );

    // The proof mechanic is preserved and demoted to a strip beneath the H1,
    // not promoted into the headline. It must exist as a labelled aside.
    const proofStrip = page.getByRole("complementary", {
      name: /live proof brief/i,
    });
    await expect(proofStrip, "live-proof strip is preserved beneath the H1").toHaveCount(1);

    // The proof strip sits below the H1 (demotion, not replacement).
    const h1Box = await h1.boundingBox();
    const stripBox = await proofStrip.boundingBox();
    expect(h1Box, "H1 has a measurable box").not.toBeNull();
    expect(stripBox, "proof strip has a measurable box").not.toBeNull();
    if (h1Box && stripBox) {
      expect(
        stripBox.y,
        "proof strip starts below the H1 (demoted, not the headline)",
      ).toBeGreaterThanOrEqual(h1Box.y + h1Box.height - 1);
    }

    // The search input and its primary CTA are both above the fold.
    const searchInput = page.getByLabel("Competitor website").first();
    const searchCta = page.getByRole("button", { name: /Preview available ads/i });
    await expect(searchInput, "search input is rendered").toBeVisible();
    await expect(searchCta, "search CTA is rendered").toBeVisible();
    await expectPrimaryActionAboveFold(searchInput, "homepage search input");
    await expectPrimaryActionAboveFold(searchCta, "homepage search CTA");

    // No horizontal scroll at either viewport (closes the residual
    // ld-ticker-belt / ld-flag overflow tracked in #1262 when it lands here).
    await expectNoHorizontalOverflow(page);

    // No console errors fire on the first viewport.
    expect(
      pageErrors,
      `expected zero page errors, got: ${pageErrors.join(" | ")}`,
    ).toEqual([]);
  });

  test(`BET 9 hero: nav collapses to a single row, not two stacked rows (${viewport.name} ${viewport.width}x${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    const navLinks = page.getByRole("navigation", { name: "Primary", exact: true });
    await expect(navLinks).toBeVisible();

    // The primary nav must occupy a single visual row (one row of links), not
    // wrap to two stacked rows that push the hero below the fold. A
    // horizontally-scrollable single row satisfies "one row"; a hamburger that
    // opens a full-height menu also satisfies it. Either way, the link row
    // count is 1.
    const rows = await navLinks.evaluate((el) => {
      const children = Array.from(el.children) as HTMLElement[];
      if (children.length === 0) return 0;
      let rows = 1;
      let prevTop = children[0].getBoundingClientRect().top;
      for (let i = 1; i < children.length; i += 1) {
        const top = children[i].getBoundingClientRect().top;
        if (Math.abs(top - prevTop) > 4) {
          rows += 1;
          prevTop = top;
        }
      }
      return rows;
    });
    expect(
      rows,
      "primary nav links occupy one row, not two stacked rows",
    ).toBe(1);
  });
}
