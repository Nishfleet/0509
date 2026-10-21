import AxeBuilder from "@axe-core/playwright";
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
  await signInOnLocalLane(page, baseURL, "a11y-brief");
});

test("the brief page passes axe at WCAG 2.2 AA and is keyboard-operable at 1440 and 390 in light and dark", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto("/app/brief");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      await testInfo.attach(`brief-${colorScheme}-${viewport.width}`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });

      await expect(page.getByRole("heading", { level: 1, name: "Your weekly brief" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);

      await page.reload();
      const order: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        await page.keyboard.press("Tab");
        order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
      }
      expect(order).toEqual(["Skip to content", "Home", "Competitors", "Brief", "Alerts", "Settings"]);
      await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings" })).toHaveCSS(
        "outline-style",
        "solid",
      );

      expect(results.violations).toEqual([]);
    }
  }
});
