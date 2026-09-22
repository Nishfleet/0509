import { expect, test } from "@playwright/test";

// Identity-card onboarding (#3885). Contract-level assertions only — no copy
// is pinned. The timed three-input journey (company domain / creator handle /
// bot-blocking brand, 1440 and 390, per docs/REBUILD-ONBOARDING.md's proof
// bar) is a production lane: it needs a live session and the deployed
// bindings, so it runs only when PLAYWRIGHT_TEST_BASE_URL points at a real
// deployment.

test("the onboarding surface is behind the session gate", async ({ page }) => {
  const response = await page.goto("/onboarding");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login/);
});

test.describe("production journey", () => {
  test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "needs the deployed Worker");

  for (const input of ["gymshark.com", "@gymshark", "https://www.youtube.com/user/GymSharkTV"]) {
    test(`one input -> confirmed card under 30 s: ${input}`, async ({ page }) => {
      const started = Date.now();
      await page.goto("/onboarding");
      const field = page.getByPlaceholder(/your website/i);
      await field.fill(input);
      await field.press("Enter");

      // First field lands, then the card completes, then "That's me" is offered.
      await expect(page.getByRole("button", { name: /me/i })).toBeVisible({ timeout: 30_000 });
      expect(Date.now() - started).toBeLessThan(30_000);
    });
  }
});
