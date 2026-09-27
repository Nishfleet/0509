import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J14 needs a real session; the local preview Worker can neither send nor receive email",
);

// The delete affordance lives on /app/settings, which requireOnboarded gates
// for an unfinished account (0509#5690): this fresh sign-in asserts the
// resume point. The delete journey on a finished account is #5512's contract,
// restored by 0509#5694's drive through onboarding.
test("J14: a fresh unfinished account's /app/settings visit lands on /onboarding", async ({ page }) => {
  // The production sign-in poll alone can overrun Playwright's 30 s default.
  test.setTimeout(120_000);
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  await page.goto("/app/settings");
  await expect(page).toHaveURL(/\/onboarding/);
});
