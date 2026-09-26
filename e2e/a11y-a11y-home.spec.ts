import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function activeName(): string {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return "";
  const label = el.getAttribute("aria-label");
  if (label !== null && label !== "") return label;
  return el.innerText.replace(/\s+/g, " ").trim();
}

test("ranked home passes axe at WCAG 2.2 AA and is keyboard-operable at 1440 and 390 in light and dark (#4150)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "this spec sets 1440 and 390 itself");

  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.goto("/design/ranked-rows");

      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);

      const ranks = page.getByRole("table", { name: "Four-week ranks" });
      await expect(ranks).toContainText("YOU");
      await expect(ranks).toContainText("Kindred");
      await expect(ranks).toContainText("3");
      await expect(ranks).toContainText("1");

      const closed = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      await testInfo.attach(`axe-home-${colorScheme}-${String(width)}`, {
        body: JSON.stringify(closed.violations, null, 2),
        contentType: "application/json",
      });
      expect(closed.violations).toEqual([]);

      await page.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      });
      const order: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        await page.keyboard.press("Tab");
        order.push(await page.evaluate(activeName));
      }
      expect(order).toEqual([
        "Kindred kindred.example",
        "Kindred tracking",
        "Loopwell loopwell.example",
        "Casetta casetta.example",
        "Casetta tracking",
      ]);

      await page.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      });
      await page.keyboard.press("Tab");
      const toggle = page.locator('[data-testid="standing-row"]').first().locator('[data-slot="row-toggle"]');
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveCSS("outline-style", "solid");
      await page.screenshot({
        path: testInfo.outputPath(`home-focus-${String(width)}-${colorScheme}.png`),
      });

      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const kindred = page.locator('[data-testid="standing-row"]', { hasText: "Kindred" });
      await expect(kindred.getByRole("status")).toHaveText("Kindred expanded");

      if (width === 390) {
        await expect(page.getByRole("dialog")).toBeVisible();
      } else {
        await expect(kindred.getByRole("tab", { name: "Site changes 2" })).toBeVisible();
      }

      const open = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      await testInfo.attach(`axe-home-open-${colorScheme}-${String(width)}`, {
        body: JSON.stringify(open.violations, null, 2),
        contentType: "application/json",
      });
      expect(open.violations).toEqual([]);
    }
  }
});
