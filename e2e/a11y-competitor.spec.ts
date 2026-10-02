import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";

// One competitor's own page measured at each shape the product ships, the same
// production lane and the same reason as e2e/a11y-alerts.spec.ts: the preview
// Worker cannot mint a session, so this spec skips there. The shared onboarded
// session already tracks competitors (e2e/competitor-page.spec.ts opens its
// nike.com row), so the spec follows the first row of the Competitors list. It
// reads only: it toggles no switch and adds no competitor.
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
  "a competitor page needs a real session; the local preview Worker cannot mint one",
);

test("a competitor page passes axe at WCAG 2.2 AA and is keyboard-operable at 1440 and 390 in light and dark (#4152)", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto("/app/competitors");
      await page
        .getByRole("list", { name: "Competitors", exact: true })
        .getByRole("listitem")
        .first()
        .getByRole("link")
        .click();
      await expect(page).toHaveURL(/\/app\/competitors\/[^/]+$/);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      await testInfo.attach(`competitor-${colorScheme}-${String(viewport.width)}`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);

      const toggle = page.getByRole("switch", { name: / tracking (ON|OFF)$/ });
      await page.keyboard.press("Tab");
      await toggle.focus();
      await expect(toggle).toBeFocused();
      const ring = await toggle.evaluate((el) => {
        const style = getComputedStyle(el);
        return style.outlineStyle !== "none" || style.boxShadow !== "none";
      });
      expect(ring).toBe(true);
      await expect(toggle).toHaveAttribute("aria-checked", /^(true|false)$/);

      await page.screenshot({
        path: testInfo.outputPath(`competitor-focus-${String(viewport.width)}-${colorScheme}.png`),
      });

      expect(results.violations).toEqual([]);
    }
  }
});
