import { test } from "@playwright/test";

import { deleteCreatedAccount, requireInboxToken, signInWithMagicLink } from "./inbox";

test("diag bluorng onboarding", async ({ page }) => {
  test.setTimeout(240_000);
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  const log: string[] = [];
  try {
    await signInWithMagicLink(page, email, token);
    page.on("response", (r) => {
      if (r.status() >= 400) log.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });
    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "your website, or a handle" });
    await input.fill("bluorng.com");
    await input.press("Enter");
    await page.waitForTimeout(25_000);
    log.push(`after-draw url=${page.url()} text=${(await page.locator("body").innerText()).slice(0, 400)}`);
    const me = page.getByRole("button", { name: "That's me" });
    if (await me.count()) {
      await me.click();
      await page.waitForTimeout(15_000);
      log.push(`after-confirm url=${page.url()} text=${(await page.locator("body").innerText()).slice(0, 400)}`);
    }
  } finally {
    await deleteCreatedAccount(page, email).catch(() => undefined);
  }
  throw new Error(`DIAG\n${log.join("\n")}`);
});
