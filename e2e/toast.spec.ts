import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// #4116's production half: a real in-place edit on the live app — the public
// card toggles on, the "saved" toast lands in the aria-live region, and Undo
// restores the previous state by re-posting the inverse intent to the same
// action, not through a second code path. Both viewport projects (1440 and
// 390) run this spec, and the toast moment is attached as a screenshot in each.
// Production only — the preview lane's wrangler dev has no EMAIL binding and no
// inbox to sign in through, so this spec skips there rather than fake the
// session (same reason as j1-magic-link.spec.ts).
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "#4116 proves the production toast; the local preview Worker can neither send nor receive email",
);

test("a card save announces itself in the live region and undoes through the same action", async ({
  page,
}, testInfo) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, token);

  await page.goto("/app/settings/card");

  // The live region is mounted before any toast exists — that is the
  // announcement channel axe checks below, not the toast element itself.
  const liveRegion = page.locator('section[aria-live="polite"]');
  await expect(liveRegion).toBeAttached();

  await page.getByRole("button", { name: "Turn the public card on" }).click();

  // The save's toast is the one element the region announces.
  const toast = liveRegion.getByText("Public card on.");
  await expect(toast).toBeVisible();
  await testInfo.attach(`toast-saved-${testInfo.project.name}`, {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  // The axe run on the mounted live region while the toast is visible.
  const axe = await new AxeBuilder({ page }).include('section[aria-live="polite"]').analyze();
  expect(axe.violations).toEqual([]);

  // Undo re-posts the inverse intent to the same action: the card goes back
  // off, and that save announces itself too.
  await liveRegion.getByRole("button", { name: "Undo" }).click();
  await expect(liveRegion.getByText("Public card off.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn the public card on" })).toBeVisible();
  await testInfo.attach(`toast-undo-${testInfo.project.name}`, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
