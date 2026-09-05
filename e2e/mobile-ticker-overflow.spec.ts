import { expect, test } from "@playwright/test";

/**
 * #1486 — the `ld-ticker-belt` marquee (`width: max-content`) used to inflate
 * `document.documentElement.scrollWidth` by 2px on a 390px mobile viewport.
 * The CSS fix (`contain: inline-size` + `overflow: hidden` + `max-width: 100%`
 * on `.ld-ticker`) landed in 546771fa. This spec is the real layout proof: it
 * renders the home page and a brand page in Chromium at 390px and asserts
 * `scrollWidth === clientWidth` exactly (zero tolerance), with the ticker
 * present on the page being measured.
 *
 * The vitest guard `tests/design-system/mobile-overflow.test.tsx` locks the
 * CSS mechanism and DOM structure; this spec locks the layout invariant
 * itself — the only place a real `scrollWidth`/`clientWidth` measurement is
 * possible.
 */
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

test.describe("mobile ticker overflow (#1486)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
  });

  test("home page: scrollWidth === clientWidth at 390px with the ticker present", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Let fonts and the marquee settle so bounding boxes match the rendered
    // layout, not a pre-font-fallback frame.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    // The ticker must be on the page being measured — otherwise this would
    // prove nothing about the marquee.
    const ticker = page.locator(".ld-ticker").first();
    await expect(ticker, "ld-ticker is present on the home page").toHaveCount(1);
    await expect(ticker).toHaveAttribute("aria-hidden", "true");

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `documentElement.scrollWidth must equal clientWidth at 390px (got scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
    ).toBe(overflow.clientWidth);
  });

  test("brand page reuses the ticker without overflowing at 390px", async ({ page }) => {
    // /ads/:domain renders the same ld-ticker* marquee via brand-ticker.tsx.
    await page.goto("/ads/nykaa.com", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    const ticker = page.locator(".ld-ticker").first();
    await expect(ticker, "ld-ticker is present on the brand page").toHaveCount(1);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `brand page documentElement.scrollWidth must equal clientWidth at 390px (got scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
    ).toBe(overflow.clientWidth);
  });
});
