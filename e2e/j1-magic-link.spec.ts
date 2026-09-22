import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// J1 from docs/REBUILD-DONE.md §A: a fresh address signs up, the magic link
// arrives over the real mail path, and the session lands on /onboarding. Production
// only — the preview lane's wrangler dev has no EMAIL binding and no inbox to
// read, so this spec skips there rather than fake the journey.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J1 proves the production mail path; the local preview Worker can neither send nor receive email",
);

test("a fresh address signs in with the magic link that was emailed to it", async ({ page }) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

  await signInWithMagicLink(page, email, token);

  // Home renders the session's address: the session is real, not just a 200.
  await expect(page.getByText(email)).toBeVisible();
});
