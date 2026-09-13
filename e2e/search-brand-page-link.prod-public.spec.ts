import { expect, test } from "@playwright/test";

/**
 * Issue #1441 — the top-of-funnel domain search renders the free preview but
 * kept it disconnected from the indexable programmatic-SEO brand page: every
 * result row's href stayed inside `/search`, so a buyer could not move from
 * the first-value moment to `/ads/:domain`, and the brand page received no
 * internal link equity from the high-traffic search route. The results header
 * now links straight to the brand destination ("See all {brand} ads") when the
 * search's brand domain resolves to an indexable brand page.
 *
 * Runs against production 0509.io (project `prod-public`). The search is a
 * live/cached Ad Library capture, so wait generously for the result rows to
 * paint before asserting on the cross-page anchor.
 */
const MAJOR_BRANDS = [
  { label: "nike", path: "/search?q=nike&country=all", brandPath: "/ads/nike.com" },
  { label: "adidas", path: "/search?q=adidas&country=all" },
  { label: "shopify", path: "/search?q=shopify&country=all" },
];

for (const brand of MAJOR_BRANDS) {
  // Shared-resource lock (issue #1727): live external production search.
  test(`${brand.label} search links to its indexable brand page`, { lock: "external-api" }, async ({
    page,
  }) => {
    // #3373: this test promises one navigation plus three 30s locator
    // waits, a sum the 30s global test cap can never honour — on
    // 2026-09-13 the nike leg died at that 30s cap and the adidas leg at
    // the 20s navigationTimeout. Same reasoning as the diagnostic-engine
    // raise: once the slow path is systematically over budget, every
    // attempt fails. 30s goto (matching its own waits), 180s test ceiling
    // (promised worst case ~150s + slack).
    test.setTimeout(180_000);
    await page.goto(brand.path, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Wait for at least one result row to render before asserting on the
    // results-header cross-link so a warming search cannot race it.
    await expect(page.locator(".f9-wk-say").first()).toBeVisible({
      timeout: 30_000,
    });

    // The cross-link is the one anchor on the page whose href points at a
    // brand-page path ("See all {brand} ads" -> /ads/:domain). The ad-result
    // rows all keep their hrefs inside /search, so an /ads/:domain anchor can
    // only be the handoff link.
    const brandLink = page.locator('a[href^="/ads/"]').first();
    await expect(brandLink).toBeVisible({ timeout: 30_000 });
    expect(await brandLink.getAttribute("href")).toMatch(/^\/ads\/[^?]+$/);

    if (brand.brandPath) {
      await expect(
        page.locator(`a[href="${brand.brandPath}"]`).first(),
      ).toBeVisible({ timeout: 30_000 });
    }
  });
}
