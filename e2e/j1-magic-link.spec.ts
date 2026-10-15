import { expect, test } from "./test";

import { deleteCreatedAccount, isLocalLane, requireInboxToken, signInWithMagicLink } from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);

  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

test("a fresh address signs in with the magic link that was emailed to it @own-signin", async ({ page }) => {
  const token = isLocalLane() ? null : requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;

  await signInWithMagicLink(page, email, token);

  await expect(page.getByText(email)).toBeVisible();
});
