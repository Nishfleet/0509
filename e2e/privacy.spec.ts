import { expect, test } from "@playwright/test";

// The /privacy contract (0509#3986). Every assertion here is reachable from the
// /privacy row in docs/FEATURE-MAP.md.
//
// Copy is pattern-matched, never pinned verbatim: a merge-queue proof that
// asserts exact strings turns every wording edit into a red gate (the landing
// h1 lesson, 2026-09-21T16:03Z). What is asserted is the contract: who we
// refuse, what we collect, one-year retention, remove and forget, the 72-hour
// takedown, and the footer address. The thirty-day and ninety-day rules are
// absent on purpose.

test("the privacy page renders its heading", async ({ page }) => {
  const response = await page.goto("/privacy");
  expect(response?.status()).toBe(200);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeEmpty();
});

test("the privacy page states who we track and what we refuse", async ({ page }) => {
  await page.goto("/privacy");

  const main = page.locator("main");
  await expect(main).toContainText(/brands, companies, products, and creators/i);
  await expect(main).toContainText(/private individual/i);
  await expect(main).toContainText(/minors/i);
  await expect(main).toContainText(/marked private/i);
  await expect(main).toContainText(/behind a login/i);
});

test("the privacy page states what we collect and what we never keep", async ({ page }) => {
  await page.goto("/privacy");

  const main = page.locator("main");
  await expect(main).toContainText(/public pages/i);
  await expect(main).toContainText(/direct messages/i);
  await expect(main).toContainText(/purchased personal data/i);
  await expect(main).toContainText(/full text/i);
});

test("the privacy page states one-year retention, deletion, and the 72-hour takedown", async ({
  page,
}) => {
  await page.goto("/privacy");

  const main = page.locator("main");
  await expect(main).toContainText(/one year/i);
  await expect(main).toContainText(/incident records/i);
  await expect(main).toContainText(/remove and forget/i);
  await expect(main).toContainText(/72 hours/i);
  await expect(main).toContainText(/takedown row/i);
  await expect(main).not.toContainText(/30 days/i);
  await expect(main).not.toContainText(/90 days/i);
  await expect(main).not.toContainText(/thirty.day/i);
  await expect(main).not.toContainText(/ninety.day/i);
  await expect(main).not.toContainText(/365/);
  await expect(main).not.toContainText(/!/);
});

test("the privacy footer carries the takedown address", async ({ page }) => {
  await page.goto("/privacy");

  const takedown = page.locator('footer a[href="mailto:support@0509.io"]');
  await expect(takedown).toBeVisible();
  await expect(takedown).toHaveAccessibleName(/\S/);
});

test("the privacy wordmark loads the landing page", async ({ page }) => {
  await page.goto("/privacy");
  await page.locator('a[href="/"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('a[href="mailto:support@0509.io"]')).toBeVisible();
});

test("the privacy page does not scroll horizontally", async ({ page }) => {
  await page.goto("/privacy");
  const width = page.viewportSize()?.width ?? 0;
  const edges = await page.evaluate(() => {
    return ["main", "footer a"].map((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return { left: rect?.left ?? 0, right: rect?.right ?? 0 };
    });
  });
  for (const edge of edges) {
    expect(edge.left).toBeGreaterThanOrEqual(0);
    expect(edge.right).toBeLessThanOrEqual(width + 1);
  }
});

test("the privacy page reaches first paint with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/privacy");
  await page.waitForLoadState("networkidle");

  expect(errors).toEqual([]);
});
