import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test";

for (const path of ["/privacy", "/terms", "/security"]) {
  test(`${path} passes axe at WCAG 2.2 AA and is keyboard-operable at 1440 and 390 in light and dark (#4156) @smoke`, async ({
    page,
  }, testInfo) => {
    for (const colorScheme of ["light", "dark"] as const) {
      for (const width of [1440, 390]) {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        await testInfo.attach(`${path}-${colorScheme}-${width}`, {
          body: JSON.stringify(results.violations, null, 2),
          contentType: "application/json",
        });
        expect(results.violations).toEqual([]);

        await expect(page.getByRole("banner")).toHaveCount(1);
        await expect(page.getByRole("main")).toHaveCount(1);
        await expect(page.getByRole("contentinfo")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

        const levels = await page
          .locator("h1, h2, h3, h4, h5, h6")
          .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
        expect(levels[0]).toBe(1);
        for (let i = 1; i < levels.length; i += 1) {
          expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
        }

        const logoBox = await page.getByRole("link", { name: "Five to Nine" }).boundingBox();
        if (logoBox === null) throw new Error("the legal logo has no box");
        expect(logoBox.height).toBeGreaterThanOrEqual(44);

        const takedown = page.getByRole("contentinfo").getByRole("link", { name: "support@0509.io" });
        await expect(takedown).toBeVisible();
        await expect(takedown).toHaveAttribute("href", "mailto:support@0509.io");

        const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
        await page.reload();
        const visited: (string | null)[] = [];
        for (const _ of hrefs) {
          await page.keyboard.press("Tab");
          visited.push((await page.evaluate(() => document.activeElement?.getAttribute("href"))) ?? null);
        }
        expect(visited).toEqual(hrefs);

        const lastHref = hrefs.at(-1);
        const lastLink = page.locator(`a[href="${lastHref}"]`).last();
        await expect(lastLink).toBeFocused();
        await expect(lastLink).toHaveCSS("outline-style", "solid");

        await page.screenshot({
          path: testInfo.outputPath(`${path.slice(1)}-${colorScheme}-${width}.png`),
        });
      }
    }
  });
}
