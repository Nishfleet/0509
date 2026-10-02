import { test, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

const BRAND = "allbirds.com";

async function record(page: Page, name: string, started: number) {
  const info = await page.evaluate(() => ({
    url: location.pathname + location.search,
    h1: document.querySelector("h1")?.textContent?.trim() ?? "",
    text: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 1500),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  console.log(`STEP ${name} t=${Date.now() - started}ms ${JSON.stringify(info)}`);
  const data = (await page.screenshot({ type: "jpeg", quality: 40, fullPage: true })).toString("base64");
  const parts = data.match(/.{1,3500}/g) ?? [];
  parts.forEach((part, i) => console.log(`SHOT ${name} ${i + 1}/${parts.length} ${part}`));
}

async function step(page: Page, name: string, started: number, action: () => Promise<void>) {
  try {
    await action();
    await page.waitForTimeout(1200);
  } catch (error) {
    console.log(`STEPFAIL ${name} ${String(error).slice(0, 300)}`);
  }
  await record(page, name, started).catch((error) => console.log(`RECORDFAIL ${name} ${String(error).slice(0, 200)}`));
}

test("ux returning customer walkthrough @own-signin", async ({ page }) => {
  test.setTimeout(900_000);
  const token = requireInboxToken();
  const started = Date.now();
  const email = `e2e+uxr${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}@0509.io`;
  console.log(`ACCOUNT ${email}`);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  await signInWithMagicLink(page, email, token);
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill(BRAND);
  await input.press("Enter");
  await page.getByRole("button", { name: "That's me" }).click({ timeout: 45_000 });
  await page.waitForURL(/\/onboarding\/competitors$/);
  await page
    .getByRole("list", { name: "Possible competitors" })
    .getByRole("listitem")
    .or(page.getByRole("list", { name: "Watching" }).getByRole("listitem"))
    .first()
    .waitFor({ timeout: 70_000 });
  await page.waitForTimeout(8000);
  await step(page, "r01-competitors-after-wait", started, async () => {});
  const watchButtons = page.getByRole("button", { name: /^Watch / });
  if ((await watchButtons.count()) > 0) await watchButtons.first().click();
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.waitForURL(/\/app$/, { timeout: 40_000 });

  await step(page, "r02-brief-day-time", started, async () => {
    await page.goto("/app/settings");
    await page.getByLabel("Day").selectOption({ label: "Tuesday" });
    await page.getByLabel("Time").selectOption({ label: "09:00" });
  });
  await step(page, "r03-settings-reload", started, async () => {
    await page.reload();
  });
  await step(page, "r04-pause-brief", started, async () => {
    await page.getByRole("button", { name: /pause the brief/i }).click();
  });
  await step(page, "r05-competitors", started, async () => {
    await page.goto("/app/competitors");
  });
  await step(page, "r06-turn-off", started, async () => {
    await page.getByRole("switch").first().click();
  });
  await step(page, "r07-turn-on", started, async () => {
    await page.getByRole("switch").first().click();
  });
  await step(page, "r08-add-competitor", started, async () => {
    await page.getByPlaceholder("their website address").fill("hoka.com");
    await page.getByRole("button", { name: "Add", exact: true }).click();
  });
  await step(page, "r09-add-bad", started, async () => {
    await page.getByPlaceholder("their website address").fill("not a website !!");
    await page.getByRole("button", { name: "Add", exact: true }).click();
  });
  await step(page, "r10-export", started, async () => {
    await page.goto("/app/settings");
    const response = await page.request.get("/app/settings/export");
    console.log(
      `EXPORT status=${response.status()} type=${response.headers()["content-type"]} disp=${response.headers()["content-disposition"]} bytes=${(await response.body()).length}`,
    );
  });
  await step(page, "r11-agents-key", started, async () => {
    await page.goto("/app/settings/agents");
    await page.getByLabel("Name").fill("walkthrough");
    await page.getByRole("button", { name: "Make a key" }).click();
  });
  await step(page, "r12-sign-out", started, async () => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/);
  });
  await step(page, "r13-signed-out-app", started, async () => {
    await page.goto("/app");
  });
  await signInWithMagicLink(page, email, token, /\/app|\/onboarding/);
  await step(page, "r14-back-in", started, async () => {});
  await step(page, "r15-competitor-forget", started, async () => {
    await page.goto("/app/competitors");
    await page.locator('a[href^="/app/competitors/"]').first().click();
    await page.waitForURL(/\/app\/competitors\/.+/);
    await page.getByLabel(/^Type .* to confirm/).fill(await page.locator("h1").innerText());
  });
  await step(page, "r16-forgot", started, async () => {
    await page.getByRole("button", { name: /^Remove and forget/ }).click();
    await page.waitForURL(/\/app\/competitors$/);
  });
  await step(page, "r17-delete-account", started, async () => {
    await page.goto("/app/settings");
    await page.getByLabel("Type " + email + " to confirm").fill(email);
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.waitForURL(/\/login\?deleted=/);
  });
  await step(page, "r18-after-delete", started, async () => {
    await page.waitForTimeout(8000);
    await page.reload();
  });
  await step(page, "r19-app-after-delete", started, async () => {
    await page.goto("/app");
  });
  console.log(`CONSOLE ${JSON.stringify(errors.slice(0, 30))}`);
});
