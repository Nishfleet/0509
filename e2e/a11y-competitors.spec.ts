import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// The Competitors page measured once at each shape the product ships, the same
// lane as `app-nav.spec.ts`: the preview Worker has no EMAIL binding and no
// inbox to read, so it cannot mint a session, and this spec skips there rather
// than fake the journey. It runs in the `e2e-production` job after deploy.
//
// The spec reads. It toggles no switch and submits no form, because it runs
// against production and a visit that wrote data would put a row in a real
// workspace for a mailbox nobody owns.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the Competitors page needs a real session; the local preview Worker cannot mint one",
);

test("the Competitors page is landmarked, ordered and keyboard-operable at 1440 and 390 in light and dark", async ({
  page,
}) => {
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto("/app/competitors");

      // One landmark set: the page's own h1, exactly one `main`, and the
      // "Places" navigation that carries the four places.
      await expect(page.getByRole("heading", { level: 1, name: "Competitors" })).toBeVisible();
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

      // Nothing wider than the viewport, at both shapes: the nav is a fixed
      // bottom bar below 860px and a rail above it, and the add-control column
      // stacks below the same point.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
        0,
      );

      // Focus order from a fresh load: a reload pins the count from the top of
      // the document, so the four Places follow each other before any content
      // on the page is reachable.
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
        path: test.info().outputPath(`competitors-focus-${String(viewport.width)}-${colorScheme}.png`),
      });

      // The add control: Tabbing reaches the labelled input, then the Add
      // button beside it.
      const add = page.getByLabel("Add one we missed");
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
