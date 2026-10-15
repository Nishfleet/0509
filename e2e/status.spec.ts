import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test";

import { consoleFailures, watchConsole } from "./inbox";

test("the status page says the app is working @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);
  const response = await page.goto("/status");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible();
  await expect(page.getByRole("main").getByText(/are working/)).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("the status page passes axe at WCAG 2.2 AA at 1440 and 390 in light and dark", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/status");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations, `${colorScheme} ${String(width)}`).toEqual([]);
    }
  }
});
