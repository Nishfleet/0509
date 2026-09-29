import { expect, test } from "@playwright/test";

import { deleteCreatedAccount, isLocalLane, requireInboxToken, signInWithMagicLink } from "./inbox";

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
// arrives over the lane's mail path, and the session lands on /onboarding.
// Production sends through Email Routing to the inbox Worker; the local
// lane's wrangler dev simulates send_email and writes the message under
// .wrangler/tmp/email/, which inbox.ts reads instead — no real sends there.
test("a fresh address signs in with the magic link that was emailed to it", async ({ page }) => {
  // The inbox secret exists only in the production job env; the local lane
  // reads wrangler's simulated-send files and has no token to require.
  const token = isLocalLane() ? null : requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;

  await signInWithMagicLink(page, email, token);

  // Home renders the session's address: the session is real, not just a 200.
  await expect(page.getByText(email)).toBeVisible();
});
