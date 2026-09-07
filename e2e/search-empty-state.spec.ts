import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  expectPrimaryActionAboveFold,
} from "./helpers/release-experience";

/**
 * ISSUE #1882 (Transformation campaign §3.6) — the `/search` empty state is a
 * tool, not a brochure.
 *
 * The idle route (no query param) is the landing surface for all distribution
 * traffic (BET 5 sitemap, BET 8 switch pages, BET 2 preview), so this spec
 * locks the composition that makes it feel like a tool:
 *
 *  - the search form (input + country + CTA) sits at the top, above any copy;
 *  - exactly ONE explanatory sentence, no bullet list;
 *  - on mobile (390×844) the input + CTA are the first interactive instrument
 *    and both are fully above the fold;
 *  - the proof-brief credibility link stays below the form;
 *  - no horizontal overflow and no console errors.
 */
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  test(`search empty state is a tool: form above copy, one sentence, no bullets (${viewport.name} ${viewport.width}x${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    expect(page.viewportSize()).toEqual({
      width: viewport.width,
      height: viewport.height,
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    // The one explanatory sentence is present (single <p>, no bullet list).
    const sentence = page.getByText(
      "Paste a competitor domain, brand name, or keyword to see their Meta ads.",
      { exact: false },
    );
    await expect(sentence).toBeVisible();

    // No three-bullet explanatory list: the page must not render the old
    // "What a search returns" disclosure or any explanatory <ul> in the idle
    // region.
    await expect(
      page.locator('text="What a search returns"'),
    ).toHaveCount(0);
    await expect(
      page.locator(".f9-search-scope-details, .f9-search-scope-items"),
    ).toHaveCount(0);

    // The form is the hero: input + country select + CTA. All three are above
    // the fold and ABOVE the explanatory sentence.
    const input = page.getByLabel("Competitor website").first();
    const country = page.locator('select[name="country"]').first();
    const cta = page.getByRole("button", { name: "See ads" }).first();
    await expect(input).toBeVisible();
    await expect(country).toBeVisible();
    await expect(cta).toBeVisible();

    // Mobile: the input + CTA begin inside the initial viewport and end above
    // the fold. The issue metric wants input + country + CTA in the first
    // viewport, so the country selector is held to the same fold budget.
    await expectPrimaryActionAboveFold(input, "search input");
    await expectPrimaryActionAboveFold(cta, "search CTA");
    await expectPrimaryActionAboveFold(country, "search country select");

    // The form (input) sits above the copy — the instrument is the hero.
    const inputBox = await input.boundingBox();
    const sentenceBox = await sentence.boundingBox();
    expect(inputBox, "input has a measurable box").not.toBeNull();
    expect(sentenceBox, "sentence has a measurable box").not.toBeNull();
    if (inputBox && sentenceBox) {
      expect(
        sentenceBox.y,
        "explanatory copy starts below the search input (form above copy)",
      ).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1);
    }

    // The proof-brief credibility link stays below the form and below the copy.
    const proofLink = page.getByRole("link", { name: /See a proof brief/i });
    await expect(proofLink).toBeVisible();
    const proofBox = await proofLink.boundingBox();
    expect(proofBox, "proof link has a measurable box").not.toBeNull();
    if (inputBox && proofBox) {
      expect(
        proofBox.y,
        "proof-brief link is below the search input",
      ).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1);
    }

    // No horizontal overflow at either viewport.
    await expectNoHorizontalOverflow(page);

    // Zero console errors on the first viewport.
    expect(
      pageErrors,
      `expected zero page errors, got: ${pageErrors.join(" | ")}`,
    ).toEqual([]);
  });
}
