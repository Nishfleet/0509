import { expect, test } from "./test";

import { onboardedStatePath } from "../playwright.config";
import { signInOnLocalLane } from "./quality";

test.use({
  storageState: async ({}, use, testInfo) => {
    await use(
      process.env.PLAYWRIGHT_TEST_BASE_URL
        ? onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop")
        : undefined,
    );
  },
});
test.beforeEach(async ({ page, baseURL }) => {
  await signInOnLocalLane(page, baseURL, "a11y-competitors");
});

test("the Competitors page is landmarked, ordered and keyboard-operable at 1440 and 390 in light and dark", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto("/app/competitors");

      await expect(page.getByRole("heading", { level: 1, name: "Competitors" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBe(0);

      await page.reload();
      const order: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        await page.keyboard.press("Tab");
        order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
      }
      expect(order).toEqual(["Skip to content", "Home", "Competitors", "Alerts", "Settings"]);
      await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings" })).toHaveCSS(
        "outline-style",
        "solid",
      );

      const add = page.getByLabel("Add a competitor we missed");
      for (let i = 0; i < 60; i += 1) {
        if (await add.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(add).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Add", exact: true })).toBeFocused();
    }
  }
});
