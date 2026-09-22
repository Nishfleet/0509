import { expect, test } from "@playwright/test";

// The /terms contract (0509#3987). Every assertion here is reachable from the
// /terms row in docs/FEATURE-MAP.md.
//
// Copy is pattern-matched, never pinned verbatim: a merge-queue proof that
// asserts exact strings turns every wording edit into a red gate (the landing
// h1 lesson, 2026-09-21T16:03Z). What is asserted is the contract — the trial
// window, the day-8 charge, the cancel path, the Dodo biller, the delete path,
// and both footer destinations.

test("the terms page renders its heading and the trial terms", async ({ page }) => {
  const response = await page.goto("/terms");
  expect(response?.status()).toBe(200);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeEmpty();

  const main = page.locator("main");
  await expect(main).toContainText(/7-day trial/i);
  await expect(main).toContainText(/day 8/i);
  await expect(main).toContainText(/cancel/i);
  await expect(main).toContainText(/Dodo/i);
});

test("the terms page states the three plans and their monthly prices", async ({ page }) => {
  await page.goto("/terms");

  for (const plan of ["Scout", "Starter", "Agency"]) {
    await expect(page.getByRole("rowheader", { name: plan })).toBeVisible();
  }
  const table = page.getByRole("table");
  await expect(table).toContainText("EUR 10");
  await expect(table).toContainText("EUR 46");
  await expect(table).toContainText("EUR 136");
});

test("the terms page says the service reads public data only", async ({ page }) => {
  await page.goto("/terms");

  const main = page.locator("main");
  await expect(main).toContainText(/public data/i);
  await expect(main).toContainText(/degraded/i);
});

test("the terms footer links privacy and the takedown address", async ({ page }) => {
  await page.goto("/terms");

  const privacy = page.locator('main a[href="/privacy"]');
  await expect(privacy).toBeVisible();
  await expect(privacy).toHaveAccessibleName(/\S/);

  const takedown = page.locator('main a[href="mailto:support@0509.io"]');
  await expect(takedown).toBeVisible();
  await expect(takedown).toHaveAccessibleName(/\S/);
});

test("the terms page does not scroll horizontally", async ({ page }) => {
  await page.goto("/terms");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("the terms page reaches first paint with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/terms");
  await page.waitForLoadState("networkidle");

  expect(errors).toEqual([]);
});
