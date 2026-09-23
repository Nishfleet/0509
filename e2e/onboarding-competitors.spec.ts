import { expect, test } from "@playwright/test";

test("the competitors screen sends a signed-out visitor to the login page", async ({ page }) => {
  await page.goto("/onboarding/competitors");
  await expect(page).toHaveURL(/\/login/);
});
