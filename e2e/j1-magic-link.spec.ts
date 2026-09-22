import { expect, test, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// J1 from docs/REBUILD-DONE.md §A: a fresh address signs up, the magic link
// arrives over the real mail path, and the session lands on the one-input
// screen. Production only — the preview lane's wrangler dev has no EMAIL
// binding and no inbox to read, so this spec skips there rather than fake the
// journey.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J1 proves the production mail path; the local preview Worker can neither send nor receive email",
);

function inputOnScreen(page: Page) {
  return page.getByRole("textbox", { name: /website, or a handle/i });
}

test("a fresh address signs in with the magic link that was emailed to it", async ({ page }) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

  await signInWithMagicLink(page, email, token);

  // The session is real, not just a 200: screen 1 sits behind the session
  // gate and is "one input, nothing else on screen" (DESIGN.md §2.3,
  // docs/REBUILD-ONBOARDING.md step 2) — it carries no email line and no
  // passkey control, per #3996. So the session proof is the landing and the
  // focus; the signed-in address's own screen is the card (#3993).
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(inputOnScreen(page)).toBeFocused();
});
