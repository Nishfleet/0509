import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// The signed-in /app visits, production only — exactly like J1: the preview
// Worker has no EMAIL binding and no inbox to read, so it cannot mint a
// session, and this spec skips there rather than fake the journey. It runs in
// the `e2e-production` job after deploy. A fresh address has no self entity
// and no onboarding run, so requireOnboarded — the app-layout middleware from
// 0509#5690 — sends every /app route to the resume point: each leg asserts
// /onboarding, never the place's own heading.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the /app visits need a real session; the local preview Worker can neither send nor receive email",
);

test("a signed-in unfinished account is sent from every /app place to /onboarding", async ({ page }) => {
  // Production lane: the sign-in poll plus the visits overrun the 30 s
  // default (0509#5681).
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  for (const path of ["/app", "/app/competitors", "/app/alerts", "/app/settings"] as const) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/onboarding/);
  }

  expect(errors).toEqual([]);
});
