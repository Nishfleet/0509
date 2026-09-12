import { expect, test, type Page } from "@playwright/test";

/**
 * Issue #3162: on /search the results section header collapsed at desktop
 * widths — "29 ads found" and the verified/likely/unmatched provenance
 * paragraph rendered one word per line beside the toolbar (the 641-900px
 * "tablet dead zone" flex-wrap fix did not extend past 900px), and at 390px
 * the toolbar clipped the Shortcuts button off the right viewport edge.
 *
 * This spec locks both viewports against the live production search:
 *   (a) 1280×800, landing state: the lead ("… ads found" + capture age)
 *       renders on normal measure — no one-word-per-line collapse and no
 *       overlap with .f9-wk-sec-acts;
 *   (b) 1280×800, result state: the provenance paragraph (.f9-tier-tail)
 *       renders full-measure (element box ≥ 300px wide);
 *   (c) 390×844: every toolbar control, including the Shortcuts button, is
 *       fully inside the viewport and the page does not scroll sideways.
 *
 * Runs via `--project=prod-public` against https://0509.io once the change
 * is deployed (prod-public's testDir is ./e2e, file suffix
 * .prod-public.spec.ts is required by the project's testMatch).
 */

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

async function assertionsForHead(page: Page) {
  // The lead heading ("N ads found") must render on normal measure: its box
  // is at least as wide as its text on one line and no taller than ~3 text
  // lines (a one-word-per-line collapse makes a short title ~20px wide and
  // several lines tall).
  const lead = page.locator(".f9-wk-sec-title").first();
  await expect(lead).toBeVisible();
  const leadBox = await lead.boundingBox();
  expect(leadBox, "results lead heading has a rendered box").not.toBeNull();
  // "29 ads found" at 17px is roughly 90-130px on one line; a collapsed box
  // squeezes to ~45px. 100px is a floor that collapses cannot pass.
  expect(
    leadBox!.width,
    `results lead collapses at desktop width (got ${leadBox!.width}px wide)` +
      " — one-word-per-line wrap",
  ).toBeGreaterThanOrEqual(100);
  // The toolbar must not overlap the lead: the acts block starts at or
  // beyond the lead's right edge whenever it shares the heading's row, and
  // when it wraps below, the lead box is full-measure anyway. Compare row
  // positions: if both sit on the first line, no horizontal overlap.
  const acts = page.locator(".f9-wk-sec-acts").first();
  await expect(acts).toBeVisible();
  const actsBox = await acts.boundingBox();
  expect(actsBox, ".f9-wk-sec-acts has a rendered box").not.toBeNull();
  const leadRight = leadBox!.x + leadBox!.width;
  const actsLeft = actsBox!.x;
  if (Math.abs(actsBox!.y - leadBox!.y) < 16) {
    // Same visual row: they must not overlap horizontally.
    expect(
      actsLeft,
      "toolbar overlaps the results lead heading on the same row",
    ).toBeGreaterThanOrEqual(leadRight - 4);
  }
}

// Shared-resource lock (issue #1727): live external production search.
test("results lead renders normal measure at 1280×800 /search?q=nike", { lock: "external-api" }, async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/search?q=nike&country=all", { waitUntil: "domcontentloaded" });

  // Wait for at least one result row to paint so the results section exists.
  await expect(page.locator(".f9-wk-say").first()).toBeVisible({
    timeout: 30_000,
  });

  await assertionsForHead(page);
});

// Shared-resource lock (issue #1727): live external production search.
test("provenance paragraph renders full-measure at 1280×800 /search?q=nike", { lock: "external-api" }, async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/search?q=nike&country=all", { waitUntil: "domcontentloaded" });

  // Wait for at least one result row to paint so the provenance tail exists.
  await expect(page.locator(".f9-wk-say").first()).toBeVisible({
    timeout: 30_000,
  });

  const tail = page.locator(".f9-tier-tail").first();
  await expect(tail, "provenance paragraph (.f9-tier-tail) is rendered").toBeVisible();
  const tailBox = await tail.boundingBox();
  expect(tailBox, ".f9-tier-tail has a rendered box").not.toBeNull();
  expect(
    tailBox!.width,
    `provenance paragraph collapses to one word per line (got ${tailBox!.width}px wide)`,
  ).toBeGreaterThanOrEqual(300);
});

// Shared-resource lock (issue #1727): live external production search.
test("at 390×844 no toolbar control is clipped and there is no horizontal scroll", { lock: "external-api" }, async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/search?q=nike&country=all", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".f9-wk-say").first()).toBeVisible({
    timeout: 30_000,
  });

  const acts = page.locator(".f9-wk-sec-acts").first();
  await expect(acts).toBeVisible();
  const controls = acts.locator("a, button, select, label");
  const count = await controls.count();
  expect(count, "toolbar controls are present").toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const box = await controls.nth(i).boundingBox();
    expect(box, `control ${i} has a rendered box`).not.toBeNull();
    expect(
      Math.ceil(box!.x + box!.width),
      `toolbar control ${i} (right edge ${(box!.x + box!.width).toFixed(0)}px) is clipped at the 390px viewport`,
    ).toBeLessThanOrEqual(392); // 2px fractional-pixel rounding tolerance
    expect(box!.x, `toolbar control ${i} starts off the left viewport edge`).toBeGreaterThanOrEqual(0);
  }

  // No horizontal page scroll introduced.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, "no horizontal page scroll at 390px").toBeLessThanOrEqual(390);
});
