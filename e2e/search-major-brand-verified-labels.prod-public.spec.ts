import { expect, test } from "@playwright/test";

/**
 * Issue #1440 — a buyer evaluating a major brand on the free preview must not
 * see the product disclaim its own subject on every row. `/search?q=nike`,
 * `/search?q=adidas` and `/search?q=shopify` each labelled every result
 * `Unmatched — …` while the matching `/ads/:domain` page treated the same ad
 * set as brand-owned/verified. The tier-label fix resolves a bare brand
 * keyword to the brand domain the rows land on, so at least one row renders
 * verified/likely instead of `Unmatched`.
 *
 * Runs against production 0509.io (project `prod-public`). The search is a
 * live/cached Ad Library capture, so wait generously for the result rows to
 * paint before reading the tier labels.
 */
const MAJOR_BRANDS = [
  { label: "nike", path: "/search?q=nike&country=all" },
  { label: "adidas", path: "/search?q=adidas&country=all" },
  { label: "shopify", path: "/search?q=shopify&country=all" },
];

for (const brand of MAJOR_BRANDS) {
  // Shared-resource lock (issue #1727): live external production search.
  test(`${brand.label} search shows at least one verified/likely row, not all Unmatched`, { lock: "external-api" }, async ({
    page,
  }) => {
    await page.goto(brand.path, { waitUntil: "domcontentloaded" });

    // Wait for at least one result row to render before asserting on labels.
    await expect(page.locator(".f9-wk-say").first()).toBeVisible({
      timeout: 30_000,
    });

    const sayTexts = await page.locator(".f9-wk-say").allTextContents();
    expect(sayTexts.length).toBeGreaterThan(0);

    const nonUnmatched = sayTexts.filter(
      (text) => !text.trim().startsWith("Unmatched —"),
    );
    expect(nonUnmatched.length).toBeGreaterThan(0);
  });
}
