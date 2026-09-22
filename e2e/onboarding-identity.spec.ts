import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// Identity-card onboarding (#3885). Contract-level assertions only — no copy
// is pinned.
//
// The timed journey tests are a production lane: they sign in over the real
// mail path (one fresh e2e+ address per input, so each card lands in a fresh
// workspace), the 30 s budget is measured from the input submit, never from
// sign-in, and the loader's streamed response is captured for the transport +
// browserMsUsed proof. They run when PLAYWRIGHT_TEST_BASE_URL points at the
// deployed Worker.
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

      const cardResponse = page.waitForResponse(
        (r) => r.url().includes("/onboarding") && r.url().includes("input="),
      );
      const field = page.getByLabel(/your website/i);
      await field.fill(input);
      const submittedAt = Date.now();
      await field.press("Enter");

      const me = page.getByRole("button", { name: /me/i });
      await expect(me).toBeVisible({ timeout: 30_000 });
      const cardAt = Date.now();
      const stream = await (await cardResponse).text().catch(() => "");
      const transport = /"transport":"(fetch|browser)"/.exec(stream)?.[1] ?? "unseen";
      const browserMsUsed = /"browserMsUsed":(\d+)/.exec(stream)?.[1] ?? "none";

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
