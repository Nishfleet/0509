import { expect, test } from "@playwright/test";

import { deleteCreatedAccount, requireInboxToken, signInWithMagicLink } from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  // The delete failing is a test failure, not a reason to keep the address:
  // clearing in finally means the next test in this worker cannot try to
  // delete an account that is already gone.
  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

// J1 from docs/REBUILD-DONE.md §A: a fresh address signs up, the magic link
// arrives over the real mail path, and the session lands on /onboarding. Production
// only — the preview lane's wrangler dev has no EMAIL binding and no inbox to
// read, so this spec skips there rather than fake the journey.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J1 proves the production mail path; the local preview Worker can neither send nor receive email",
);

test("a fresh address signs in with the magic link that was emailed to it @own-signin", async ({ page }) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;

  await signInWithMagicLink(page, email, token);

  // Home renders the session's address: the session is real, not just a 200.
  await expect(page.getByText(email)).toBeVisible();
});
