import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";

// Settings measured at each shape the product ships, the same production lane
// and the same reason as e2e/a11y-alerts.spec.ts: the preview Worker has no
// EMAIL binding and no inbox to read, so it cannot mint a session, and this
// spec skips there rather than fake the journey. It reads only: it submits no
// form, because it runs against production and a visit that wrote data would
// put a row in a real workspace for a mailbox nobody owns.
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
  "Settings needs a real session; the local preview Worker cannot mint one",
);

test("Settings passes axe at WCAG 2.2 AA and every control is reachable by keyboard at 1440 and 390 in light and dark (#4154)", async ({
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
      await page.goto("/app/settings");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      await testInfo.attach(`settings-${colorScheme}-${String(viewport.width)}`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });

      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);

      const interactive = await page
        .locator("main")
        .locator("a[href], button, input:not([type=hidden]), select, textarea, [role=switch]")
        .evaluateAll(
          (els) =>
            els.filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width > 0 && box.height > 0;
            }).length,
        );

      await page.reload();
      const reached = new Set<string>();
      const unnamed: string[] = [];
      const unringed: string[] = [];
      for (let i = 0; i < interactive + 12; i += 1) {
        await page.keyboard.press("Tab");
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const label = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
          const labelled = (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? "";
          const style = getComputedStyle(el);
          return {
            key: `${el.tagName}|${label}|${labelled}|${el.getAttribute("href") ?? ""}`,
            name: label !== "" || labelled !== "",
            ring: style.outlineStyle !== "none" || style.boxShadow !== "none",
            inMain: el.closest("main") !== null,
          };
        });
        if (focused === null) continue;
        if (reached.has(focused.key)) continue;
        reached.add(focused.key);
        if (!focused.name) unnamed.push(focused.key);
        if (!focused.ring) unringed.push(focused.key);
      }
      expect(unnamed).toEqual([]);
      expect(unringed).toEqual([]);
      expect(reached.size).toBeGreaterThanOrEqual(interactive);

      await page.screenshot({
        path: testInfo.outputPath(`settings-focus-${String(viewport.width)}-${colorScheme}.png`),
      });

      expect(results.violations).toEqual([]);
    }
  }
});
