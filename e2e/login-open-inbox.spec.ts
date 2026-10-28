import { expect, test } from "./test";

import { deleteCreatedAccount, isLocalLane, settleSignInWidget } from "./inbox";

test.skip(!isLocalLane(), "a Gmail address would be mailed for real on the remote lanes");

const requested: string[] = [];
test.afterEach(async ({ page }) => {
  for (const email of requested.splice(0)) await deleteCreatedAccount(page, email);
});

function mint(domain: string): string {
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@${domain}`;
  requested.push(email);
  return email;
}

test("the sent state links straight to the webmail for a Gmail address and not for a work address", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(mint("gmail.com"));
  await settleSignInWidget(page);
  await page.locator('button[type="submit"]').click();

  const open = page.getByRole("link", { name: /open gmail/i });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute("href", /^https:\/\/mail\.google\.com\//);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", /noopener/);

  await page.getByRole("button", { name: "Use a different email" }).click();
  await page.locator('input[name="email"]').fill(mint("acme-e2e.test"));
  await settleSignInWidget(page);
  await page.locator('button[type="submit"]').click();

  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^open /i })).toHaveCount(0);
});
