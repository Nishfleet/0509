import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// The Alerts page measured at each shape the product ships, the same production
// lane and the same reason as e2e/a11y-competitors.spec.ts and
// e2e/a11y-onboarding.spec.ts: the preview Worker has no EMAIL binding and no
// inbox to read, so it cannot mint a session, and this spec skips there rather
// than fake the journey. It runs in the `e2e-production` job after deploy.
//
// The spec reads. It clicks no chip and submits no form, because it runs
// against production and a visit that wrote data would put a row in a real
// workspace for a mailbox nobody owns.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the Alerts page needs a real session; the local preview Worker cannot mint one",
);

test("the Alerts page passes axe at WCAG 2.2 AA and is keyboard-operable at 1440 and 390 in light and dark (#4153)", async ({
  page,
}, testInfo) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, token);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto("/app/alerts");

      // The WCAG 2.2 AA gate: axe-core inside the existing Playwright suite,
      // the same tag set the onboarding spec scans with, and the violations
      // attached so a red run names the rule that failed.
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      await testInfo.attach(`alerts-${colorScheme}-${viewport.width}`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });
      expect(results.violations).toEqual([]);

      // One landmark set: the page's own h1, exactly one `main`, and the
      // "Places" navigation that carries the four places.
      await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Places" })).toBeVisible();

      // Heading order: the first heading is the h1 and no level is skipped, so
      // the page reads as an outline rather than a flat list of styled text.
      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);

      // Focus order from a fresh load: a reload pins the count from the top of
      // the document, so the four Places follow each other before any content
      // on the page is reachable. The focused Settings link carries a visible
      // outline.
      await page.reload();
      const order: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press("Tab");
        order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
      }
      expect(order).toEqual(["Home", "Competitors", "Alerts", "Settings"]);
      await expect(page.getByRole("navigation", { name: "Places" }).getByRole("link", { name: "Settings" })).toHaveCSS(
        "outline-style",
        "solid",
      );

      await page.screenshot({
        path: test.info().outputPath(`alerts-focus-${String(viewport.width)}-${colorScheme}.png`),
      });
    }
  }
});
