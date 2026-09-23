import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// Identity-card onboarding (#3885). Contract-level assertions only — no copy
// is pinned.
//
// The timed journey tests are a production lane: they sign in over the real
// mail path (one fresh e2e+ address per input, so each card lands in a fresh
// workspace), the 30 s budget is measured from the input submit, never from
// sign-in, and the rendered card carries the transport + browserMsUsed the
// build recorded in identity_json (data-* on .identity-card). They run when
// PLAYWRIGHT_TEST_BASE_URL points at the deployed Worker.
//
// The session-gate test runs in every lane, preview included: webServer now
// applies migrations/ to the local D1 before `wrangler dev`, so Better Auth's
// schema probe passes and the unauthenticated redirect is real, not a 500.

test("the onboarding surface is behind the session gate", async ({ page }) => {
  const response = await page.goto("/onboarding");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login/);
});

test.describe("production lane", () => {
  test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "needs the deployed Worker");

  for (const input of ["gymshark.com", "@gymshark", "https://www.youtube.com/user/GymSharkTV"]) {
    test(`one input -> confirmed card under 30 s: ${input}`, async ({ page }) => {
      const token = requireInboxToken();
      const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
      await signInWithMagicLink(page, email, token);

      const field = page.getByLabel(/your website/i);
      await field.fill(input);
      const submittedAt = Date.now();
      await field.press("Enter");

      const me = page.locator('button[type="submit"]').filter({ hasText: /me/i });
      await expect(me).toBeVisible({ timeout: 30_000 });
      const cardAt = Date.now();

      // The transport proof is what the card persisted: the built card renders
      // the transport and browser-milliseconds recorded in identity_json.
      const cardEl = page.locator(".identity-card");
      const transport = await cardEl.getAttribute("data-transport");
      const browserMsUsed = await cardEl.getAttribute("data-browser-ms-used");
      expect(transport).toMatch(/^(fetch|browser|none)$/);
      if (transport === "browser") expect(browserMsUsed).toMatch(/^\d+$/);

      await me.click();
      await expect(page).toHaveURL(/\/app\/competitors/, { timeout: 30_000 });
      const doneAt = Date.now();

      console.log(
        `identity-card input=${input} transport=${transport} browserMsUsed=${browserMsUsed} ` +
          `inputToCardMs=${cardAt - submittedAt} cardToCompetitorsMs=${doneAt - cardAt} totalMs=${doneAt - submittedAt}`,
      );
      expect(cardAt - submittedAt).toBeLessThan(30_000);
    });
  }
});
