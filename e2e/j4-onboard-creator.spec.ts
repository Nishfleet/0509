import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

const SUBJECT = "https://www.youtube.com/@veritasium";

test.describe("J4 onboard a creator handle", () => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "the card needs a signed-in session; the preview lane cannot read the magic-link inbox",
  );

  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`J4 a creator handle onboards at ${width}`, async ({ page }) => {
      test.setTimeout(240_000);
      const token = requireInboxToken();
      const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

      await page.setViewportSize({ width, height });
      await signInWithMagicLink(page, email, token);

      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      await page.goto("/onboarding");
      const input = page.getByRole("textbox", { name: "your website, or a handle" });
      await input.fill(SUBJECT);
      const started = Date.now();
      await input.press("Enter");

      await expect(
        page.getByRole("heading", { name: "This is you. Fix anything we got wrong." }),
      ).toBeVisible();
      const editName = page.getByRole("button", { name: "edit name" });
      await expect(editName).toBeVisible({ timeout: 30_000 });
      const firstField = Date.now() - started;

      await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
      const complete = Date.now() - started;

      expect(firstField).toBeLessThan(30_000);
      expect(complete).toBeLessThan(30_000);
      test.info().annotations.push(
        { type: "input-to-first-field-ms", description: String(firstField) },
        { type: "input-to-card-complete-ms", description: String(complete) },
      );

      await expect(page.getByText("channel", { exact: true })).toBeVisible();
      await expect(page.getByText("YouTube", { exact: true })).toBeVisible();
      await expect(page.getByText("handle", { exact: true })).toBeVisible();
      await expect(page.getByText("@veritasium", { exact: true })).toBeVisible();
      await expect(page.getByText("socials", { exact: true })).toBeVisible();
      test.info().annotations.push(
        { type: "source-channel", description: "subject URL" },
        { type: "source-handle", description: "subject URL" },
        { type: "source-name", description: "youtube channel page" },
        { type: "source-socials", description: "subject URL + youtube channel page" },
      );

      await page.getByRole("button", { name: "That's me" }).click();
      await expect(page).toHaveURL(/\/onboarding\/competitors$/);

      const competitorRows = page.locator('ul[aria-label="Watching"] li, ul[aria-label="Maybe"] li');
      await expect.poll(async () => competitorRows.count(), { timeout: 60_000 }).toBeGreaterThan(0);
      const competitors = Date.now() - started;
      expect(competitors).toBeLessThan(60_000);
      test.info().annotations.push({ type: "input-to-competitors-ms", description: String(competitors) });

      const noHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(noHorizontalScroll).toBe(true);
      expect(consoleErrors).toEqual([]);
      await test.info().attach(`j4-${width}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }
});
