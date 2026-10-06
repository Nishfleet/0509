import { expect, test } from "@playwright/test";

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

test("an onboarded user with no plan row cannot reach Home @own-signin", async ({ page }) => {
  test.setTimeout(180_000);
  const email = `e2e+paywall-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;
  await signInWithMagicLink(page, email, isLocalLane() ? null : requireInboxToken());

  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("gymshark.com");
  await input.press("Enter");

  await expect(page.getByRole("button", { name: "That's me" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });

  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(
    watching
      .first()
      .or(page.getByRole("button", { name: /^Watch / }).first())
      .first(),
  ).toBeVisible({ timeout: 60_000 });
  if ((await watching.count()) === 0) {
    await page
      .getByRole("button", { name: /^Watch / })
      .first()
      .click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/onboarding\/plan$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Start your trial" })).toBeVisible();

  await page.goto("/app");
  await expect(page).toHaveURL(/\/onboarding\/plan$/);
  await expect(page.locator('[data-home="standing"]')).toHaveCount(0);
});
