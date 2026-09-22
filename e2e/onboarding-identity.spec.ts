import { expect, test } from "@playwright/test";

// Identity-card onboarding (#3885). Contract-level assertions only — no copy
// is pinned. The whole file is a production lane: `wrangler dev --local`
// starts with an empty D1 and preview-assert applies no migrations (the same
// boundary smoke.spec.ts documents), so even the unauthenticated session-gate
// check would 500 inside Better Auth's schema probe rather than redirect. It
// runs when PLAYWRIGHT_TEST_BASE_URL points at the deployed Worker, whose D1
// is migrated.

test.describe("production lane", () => {
  test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "needs the deployed Worker");

  test("the onboarding surface is behind the session gate", async ({ page }) => {
    const response = await page.goto("/onboarding");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login/);
  });

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
