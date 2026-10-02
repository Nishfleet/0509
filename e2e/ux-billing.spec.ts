import { test, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

async function record(page: Page, name: string) {
  const info = await page.evaluate(() => ({
    url: location.pathname + location.search,
    text: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 2500),
  }));
  console.log(`STEP ${name} ${JSON.stringify(info)}`);
}

test("ux billing check @own-signin", async ({ page }) => {
  test.setTimeout(600_000);
  const token = requireInboxToken();
  const email = `e2e+uxb${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}@0509.io`;
  await signInWithMagicLink(page, email, token);
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("allbirds.com");
  await input.press("Enter");
  await page.getByRole("button", { name: "That's me" }).click({ timeout: 45_000 });
  await page.waitForURL(/\/onboarding\/competitors$/);
  await page
    .getByRole("list", { name: "Possible competitors" })
    .getByRole("listitem")
    .or(page.getByRole("list", { name: "Watching" }).getByRole("listitem"))
    .first()
    .waitFor({ timeout: 70_000 });
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.waitForURL(/\/app$/, { timeout: 40_000 });

  for (const path of ["/pricing", "/", "/app/settings", "/app/competitors", "/app/competitors?upgraded=starter"]) {
    await page.goto(path).catch((error) => console.log(`GOFAIL ${path} ${String(error).slice(0, 100)}`));
    await page.waitForTimeout(1500);
    await record(page, path).catch((error) => console.log(`RECFAIL ${path} ${String(error).slice(0, 100)}`));
  }

  const res = await page.request.post("/app/upgrade", { form: { plan: "scout" }, maxRedirects: 0 });
  const where = res.headers()["location"] ?? "";
  let shown = where;
  try {
    const u = new URL(where, "https://0509.io");
    shown = `${u.origin}${u.pathname.replace(/[A-Za-z0-9_-]{12,}/g, "<id>")}`;
  } catch {
    shown = "unparsed";
  }
  console.log(`UPGRADE status=${String(res.status())} location=${shown} body=${(await res.text()).slice(0, 300)}`);
  const bill = await page.request.post("/app/settings/billing", { maxRedirects: 0 });
  console.log(`BILLING status=${String(bill.status())} body=${(await bill.text()).slice(0, 300)}`);
});
