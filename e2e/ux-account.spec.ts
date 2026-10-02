import { test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test("ux account section @own-signin", async ({ page }) => {
  test.setTimeout(300_000);
  const token = requireInboxToken();
  const email = `e2e+uxa${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}@0509.io`;
  await signInWithMagicLink(page, email, token);
  await page.goto("/app/settings");
  await page.getByRole("tab", { name: /^account$/i }).or(page.getByRole("link", { name: /^account$/i })).first().click();
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => document.body.innerText);
  console.log(`ACCOUNTTEXT ${JSON.stringify(text.slice(0, 2600))}`);
});
