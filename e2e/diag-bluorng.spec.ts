import { test } from "@playwright/test";

import { deleteCreatedAccount, requireInboxToken, signInWithMagicLink } from "./inbox";

test("diag bluorng onboarding", async ({ page }) => {
  test.setTimeout(240_000);
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  const log: string[] = [];
  const snap = async (label: string) =>
    log.push(`${label} url=${page.url()} text=${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500)}`);
  try {
    await signInWithMagicLink(page, email, token);
    page.on("response", (r) => {
      if (r.status() >= 400) log.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 120)} ref=${r.headers()["x-error-reference"] ?? ""}`);
    });
    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "your website address or social username (like @yourbrand)" });
    await input.fill("bluorng.com");
    await input.press("Enter");
    await page.waitForTimeout(8_000);
    await snap("after-draw");
    const yes = page.getByRole("button", { name: "Yes, a business or creator" });
    if (await yes.count()) {
      await yes.click();
      await page.waitForTimeout(25_000);
      await snap("after-yes");
    }
    const me = page.getByRole("button", { name: "That's me" });
    if (await me.count()) {
      await me.click();
      await page.waitForTimeout(12_000);
      await snap("after-confirm");
    }
  } finally {
    await deleteCreatedAccount(page, email).catch(() => undefined);
  }
  throw new Error(`DIAG\n${log.join("\n")}`);
});
