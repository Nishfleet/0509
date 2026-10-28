import { expect, test } from "./test";

import { consoleFailures, watchConsole } from "./inbox";

test("the security page renders its heading and date @smoke", async ({ page }) => {
  const response = await page.goto("/security");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1, name: "Security" })).toBeVisible();
  await expect(page.locator("main time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
});

test("the security page says where data lives, how sign-in works and what agents can do @smoke", async ({ page }) => {
  await page.goto("/security");

  const main = page.locator("main");
  await expect(main).toContainText(/Cloudflare/);
  await expect(main).toContainText(/no passwords to steal/i);
  await expect(main).toContainText(/passkey/i);
  await expect(main).toContainText(/cannot change/i);
  await expect(main).toContainText(/never read anything behind a login/i);
});

test("the security page tells a researcher how to report and links security.txt and privacy @smoke", async ({
  page,
}) => {
  await page.goto("/security");

  await expect(page.locator("main")).toContainText(/email the address under contact/i);
  await expect(page.locator('main a[href="/.well-known/security.txt"]')).toBeVisible();
  await expect(page.locator('main a[href="/privacy"]')).toBeVisible();
  await expect(page.locator('main a[href="mailto:support@0509.io"]')).toBeVisible();
});

test("the security page is open to search engines @smoke", async ({ page }) => {
  await page.goto("/security");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
});

test("the security contents list reaches every section @smoke", async ({ page }) => {
  await page.goto("/security");

  const links = page.getByRole("navigation", { name: "On this page" }).getByRole("link");
  await expect(links).toHaveCount(await page.locator("main h2").count());
  for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")))) {
    await expect(page.locator(`main h2${href ?? ""}`)).toHaveCount(1);
  }
});

test("the security page does not scroll horizontally @smoke", async ({ page }) => {
  await page.goto("/security");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("the security page reaches first paint with no console errors @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  await page.goto("/security");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
