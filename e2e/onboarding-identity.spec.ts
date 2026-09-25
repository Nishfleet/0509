import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test("the card screen sends a signed-out visitor to the login page", async ({ page }) => {
  await page.goto("/onboarding/identity?subject=gymshark.com");
  await expect(page).toHaveURL(/\/login/);
});

test.describe("signed in", () => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "the card needs a signed-in session; the preview lane cannot read the magic-link inbox",
  );

  test("one input becomes a card the user can fix and confirm", async ({ page }) => {
    const token = requireInboxToken();
    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
    await signInWithMagicLink(page, email, token);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "your website, or a handle" });
    await input.fill("gymshark.com");
    await input.press("Enter");

    await expect(page).toHaveURL(/\/onboarding\/identity\?subject=gymshark\.com$/);
    await expect(page.getByRole("heading", { name: "This is you. Fix anything we got wrong." })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toBeVisible();
    await expect(page.getByText("gymshark.com", { exact: true })).toBeVisible();

    const editName = page.getByRole("button", { name: "edit name" });
    await expect(editName).toBeVisible({ timeout: 30_000 });
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalScroll).toBe(true);

    await editName.click();
    const name = page.getByRole("textbox", { name: "name" });
    await name.fill("Gymshark");
    await name.press("Escape");
    await page.getByRole("button", { name: "That's me" }).click();

    await expect(page).toHaveURL(/\/onboarding\/competitors$/);
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/app$/);
    expect(consoleErrors).toEqual([]);
  });

  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`the card fills within 30 s at ${width}`, async ({ page }) => {
      const token = requireInboxToken();
      const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

      await page.setViewportSize({ width, height });
      await signInWithMagicLink(page, email, token);

      // Same listener the test above uses, and the same placement: the empty
      // list is a claim about the card screen, so it starts once the signed-in
      // session is established.
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      await page.goto("/onboarding");
      const input = page.getByRole("textbox", { name: "your website, or a handle" });
      await input.fill("gymshark.com");
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

      await expect(
        page.getByRole("heading", { name: "This is you. Fix anything we got wrong." }),
      ).toBeInViewport();
      await expect(page.getByRole("button", { name: "edit name" })).toBeInViewport();
      await expect(page.getByText("logo", { exact: true })).toBeInViewport();
      await expect(page.getByRole("button", { name: "edit about" })).toBeInViewport();
      await expect(page.getByText("socials", { exact: true })).toBeInViewport();

      const noHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(noHorizontalScroll).toBe(true);
      expect(consoleErrors).toEqual([]);
      await test.info().attach(`card-${width}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }
});
