import { test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

const BRAND = "linear.app";
const READ_MS = 2500;

test("rival timing linear.app fast @own-signin", async ({ page }) => {
  test.setTimeout(300_000);
  const token = requireInboxToken();
  const email = `e2e+rt${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}@0509.io`;
  console.log(`ACCOUNT ${email} brand=${BRAND} mode=fast read=${READ_MS}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInWithMagicLink(page, email, token);
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await page.goto("/onboarding");
  await input.waitFor();
  await input.fill(BRAND);
  const enterAt = Date.now();
  await input.press("Enter");
  await page.getByRole("button", { name: "edit name" }).waitFor({ timeout: 45_000 });
  const cardAt = Date.now();
  console.log(`CARD-MS ${cardAt - enterAt}`);
  await page.waitForTimeout(READ_MS);
  const confirmAt = Date.now();
  await page.getByRole("button", { name: "That's me" }).click();
  await page.waitForURL(/\/onboarding\/competitors$/, { timeout: 15_000 });
  const listed = page
    .getByRole("list", { name: "Watching" })
    .getByRole("listitem")
    .or(page.getByRole("list", { name: "Possible competitors" }).getByRole("listitem"));
  await listed.first().waitFor({ timeout: 90_000 });
  const listAt = Date.now();
  console.log(`TIMING mode=fast brand=${BRAND} card_to_list_ms=${listAt - cardAt} confirm_to_list_ms=${listAt - confirmAt} read_ms=${READ_MS}`);
  await page.waitForTimeout(2000);
  const names = await page
    .getByRole("list", { name: "Watching" })
    .getByRole("listitem")
    .or(page.getByRole("list", { name: "Possible competitors" }).getByRole("listitem"))
    .allInnerTexts();
  console.log(`RIVALS ${JSON.stringify(names.map((n) => n.replace(/\s+/g, " ").slice(0, 80)))}`);
});
