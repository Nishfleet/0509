import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "@playwright/test";

import { isLocalLane } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database; production reads a real ranked /app",
);

function activeName(): string {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return "";
  const label = el.getAttribute("aria-label");
  if (label !== null && label !== "") return label;
  return el.innerText.replace(/\s+/g, " ").trim();
}

test("ranked home passes axe at WCAG 2.2 AA and is keyboard-operable at 1440 and 390 in light and dark (#4150) @smoke", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "this spec sets 1440 and 390 itself");

  const cookie = await seedRankedHomeSession("a11y-ranked-home");
  await page.setExtraHTTPHeaders({ cookie });

  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1440, 390] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.goto("/app");

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
      await expect(ranks.getByRole("row").filter({ hasText: "YOU" }).getByRole("cell")).toHaveText([
        "3",
        "3",
        "2",
        "2",
      ]);
      await expect(ranks.getByRole("row").filter({ hasText: "Kindred" }).getByRole("cell")).toHaveText([
        "2",
        "1",
        "1",
        "1",
      ]);

      // The degraded pill is part of what the scan covers: the seeded week
      // leaves Hacker News unanswered, so its dashed, dimmed pill is on the
      // page in both themes rather than only asserted by another spec.
      await expect(page.locator('[data-slot="row-pills"] li[data-state="degraded"]').first()).toBeVisible();

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
      // The app shell's nav is the first focusable content, then Home's own
      // **How this is ranked** button, then the standing rows in rank order —
      // the self row's switch is disabled and reads YOU, so it is skipped.
      for (let i = 0; i < 10; i += 1) {
        await page.keyboard.press("Tab");
        order.push(await page.evaluate(activeName));
      }
      expect(order).toEqual([
        "HOME",
        "COMPETITORS",
        "ALERTS",
        "SETTINGS",
        "HOW THIS IS RANKED",
        "Kindred kindred.example",
        "Kindred tracking",
        "Loopwell loopwell.example",
        "Casetta casetta.example",
        "Casetta tracking",
      ]);

      // The order walk ends on "Casetta tracking"; walking backward along the
      // list it just asserted reaches the first row's toggle — no restart, so
      // no dependence on where the browser resumes sequential focus.
      const toggle = page.locator('[data-testid="standing-row"]').first().locator('[data-slot="row-toggle"]');
      for (let i = 0; i < 4; i += 1) await page.keyboard.press("Shift+Tab");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveCSS("outline-style", "solid");
      await page.screenshot({
        path: testInfo.outputPath(`home-focus-${String(width)}-${colorScheme}.png`),
      });

      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const kindred = page.locator('[data-testid="standing-row"]', { hasText: "Kindred" });

      if (width === 390) {
        await expect(page.getByRole("dialog", { name: "Kindred" })).toBeVisible();
      } else {
        await expect(kindred.getByRole("status")).toHaveText("Kindred expanded");
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
