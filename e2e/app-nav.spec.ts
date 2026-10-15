import { expect, test } from "./test";

import { onboardedStatePath } from "../playwright.config";
import { consoleFailures, watchConsole } from "./inbox";

test.use({
  storageState: async ({}, use, testInfo) => {
    await use(
      process.env.PLAYWRIGHT_TEST_BASE_URL
        ? onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop")
        : undefined,
    );
  },
});

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the nav walk needs a real session; the local preview Worker can neither send nor receive email",
);

test("a signed-in user reaches the four places by tapping and by Tab+Enter", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const watched = watchConsole(page);

  const nav = page.getByRole("navigation", { name: "Primary" });
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto("/app/competitors");

  await expect(page.getByRole("heading", { level: 1, name: "Competitors", exact: true })).toBeVisible();
  expect(await noOverflow()).toBe(0);
  await page.screenshot({ path: test.info().outputPath("competitors.png") });

  for (const [place, path] of [
    ["Alerts", "/app/alerts"],
    ["Settings", "/app/settings"],
  ] as const) {
    await nav.getByRole("link", { name: place }).click();
    await page.waitForURL(new RegExp(path + "$"));
    await expect(page.getByRole("heading", { level: 1, name: place, exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: place })).toHaveAttribute("aria-current", "page");
    expect(await noOverflow()).toBe(0);
    await page.screenshot({ path: test.info().outputPath(`${place.toLowerCase()}.png`) });
  }

  await nav.getByRole("link", { name: "Competitors" }).click();
  await page.waitForURL(/\/app\/competitors$/);
  await nav.getByRole("link", { name: "Home" }).click();
  await page.waitForURL(/\/app$/);

  for (const [, path, tabs] of [
    ["Competitors", "/app/competitors", 3],
    ["Alerts", "/app/alerts", 4],
    ["Settings", "/app/settings", 5],
  ] as const) {
    await page.goto("/app/alerts");
    for (let index = 0; index < tabs; index += 1) {
      await page.keyboard.press("Tab");
    }
    const focused = page.locator(":focus");
    await expect(focused).toHaveAttribute("href", path);
    await expect(focused).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(path + "$"));
  }

  await page.goto("/app/alerts");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("href", "#app-content");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("href", "/app");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/app$/);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
