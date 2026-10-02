import { test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test("ux account section @own-signin", async ({ page }) => {
  test.setTimeout(300_000);
  const token = requireInboxToken();
  const email = `e2e+uxa${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}@0509.io`;
  await signInWithMagicLink(page, email, token);
  await page.goto("/app/settings");
  const text = await page.evaluate(() => document.body.innerText.replace(/
{2,}/g, "
"));
  console.log(`ACCOUNTTEXT ${JSON.stringify(text)}`);
  const html = await page.evaluate(() => document.body.innerText.length);
  console.log(`LEN ${html}`);
});
