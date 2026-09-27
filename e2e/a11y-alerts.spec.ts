import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// The Alerts page's signed-in visit, the same production lane and the same
// reason as e2e/a11y-competitors.spec.ts and e2e/a11y-onboarding.spec.ts: the
// preview Worker has no EMAIL binding and no inbox to read, so it cannot mint
// a session, and this spec skips there rather than fake the journey. It runs
// in the `e2e-production` job after deploy.
//
// The account is fresh and unfinished, so requireOnboarded — the app-layout
// middleware from 0509#5690 — sends /app/alerts to the resume point. The spec
// asserts the landing; the WCAG 2.2 AA scan of the page itself returns on a
// finished account under 0509#5694.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the Alerts page needs a real session; the local preview Worker cannot mint one",
);

test("a signed-in unfinished account's /app/alerts visit lands on /onboarding (#4153)", async ({ page }) => {
  // The production sign-in poll alone can overrun Playwright's 30 s default.
  test.setTimeout(180_000);
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  await page.goto("/app/alerts");
  await expect(page).toHaveURL(/\/onboarding/);
});
