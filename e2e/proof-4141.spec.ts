import { test, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

async function shot(page: Page, name: string) {
  const info = await page.evaluate(() => ({
    url: location.pathname,
    panel: document.querySelector('[data-home="first-file"]')?.textContent ?? "NO PANEL",
    text: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 2500),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  console.log(`STEP ${name} utc=${new Date().toISOString()} ${JSON.stringify(info)}`);
  const data = (await page.screenshot({ type: "jpeg", quality: 55, fullPage: true })).toString("base64");
  const parts = data.match(/.{1,3500}/g) ?? [];
  parts.forEach((part, i) => console.log(`SHOT ${name} ${i + 1}/${parts.length} ${part}`));
}

test("proof 4141 first-file panel arrival time @own-signin", async ({ page }) => {
  test.setTimeout(600_000);
  const token = requireInboxToken();
  const email = `e2e+p4141${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}@0509.io`;
  console.log(`ACCOUNT ${email}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInWithMagicLink(page, email, token);
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("gymshark.com");
  await input.press("Enter");
  await page.getByRole("button", { name: "edit name" }).waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await page.waitForURL(/\/onboarding\/competitors$/, { timeout: 15_000 });
  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await watching
    .first()
    .or(page.getByRole("button", { name: /^Watch / }).first())
    .first()
    .waitFor({ timeout: 70_000 });
  if ((await watching.count()) === 0) await page.getByRole("button", { name: /^Watch / }).first().click();
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.waitForURL(/\/app$/, { timeout: 40_000 });
  console.log(`ONBOARDED utc=${new Date().toISOString()}`);
  await page.waitForTimeout(2000);
  await shot(page, "home-1440");
  await page.reload();
  await page.waitForTimeout(1500);
  await shot(page, "home-1440-reload");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await page.waitForTimeout(1500);
  await shot(page, "home-390");
});
