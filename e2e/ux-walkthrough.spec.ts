import { test, type Page } from "@playwright/test";

import { decodedBodies, readRawMessage, requireInboxToken, signInWithMagicLink } from "./inbox";

const BRAND = "allbirds.com";

async function record(page: Page, name: string, started: number) {
  const info = await page.evaluate(() => ({
    url: location.pathname + location.search,
    h1: document.querySelector("h1")?.textContent?.trim() ?? "",
    text: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 1800),
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
    await page.waitForTimeout(800);
  } catch (error) {
    console.log(`STEPFAIL ${name} ${String(error).slice(0, 300)}`);
  }
  await record(page, name, started).catch((error) => console.log(`RECORDFAIL ${name} ${String(error).slice(0, 200)}`));
}

test("ux walkthrough as a brand new customer @own-signin", async ({ page }) => {
  test.setTimeout(600_000);
  const token = requireInboxToken();
  const started = Date.now();
  const email = `e2e+ux${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}@0509.io`;
  console.log(`ACCOUNT ${email} brand=${BRAND}`);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  await page.setViewportSize({ width: 1440, height: 900 });
  await step(page, "01-landing", started, async () => {
    await page.goto("/");
  });
  await step(page, "02-landing-design", started, async () => {
    await page.goto("/design/landing");
  });
  await step(page, "03-login", started, async () => {
    await page.goto("/login");
  });

  const signInStart = Date.now();
  await signInWithMagicLink(page, email, token);
  console.log(`SIGNIN-MS ${Date.now() - signInStart}`);
  try {
    const raw = await readRawMessage(email, token);
    const header = raw.split(/\r?\n\r?\n/)[0] ?? "";
    console.log(
      `EMAIL-HEADERS ${JSON.stringify(header.split(/\r?\n/).filter((l) => /^(subject|from|to|reply-to):/i.test(l)))}`,
    );
    console.log(
      `EMAIL-BODY ${JSON.stringify((decodedBodies(raw)[0] ?? "").replace(/https:\/\/\S+verify\S*/g, "<link>").slice(0, 2500))}`,
    );
  } catch (error) {
    console.log(`EMAILFAIL ${String(error).slice(0, 200)}`);
  }
  await step(page, "04-after-signin", started, async () => {});

  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await step(page, "05-onboarding-empty", started, async () => {
    await page.goto("/onboarding");
    await input.waitFor();
  });
  await step(page, "06-onboarding-typed", started, async () => {
    await input.fill(BRAND);
  });
  const inputAt = Date.now();
  await step(page, "07-onboarding-loading", started, async () => {
    await input.press("Enter");
    await page.waitForTimeout(1200);
  });
  await step(page, "08-brand-card", started, async () => {
    await page.getByRole("button", { name: "edit name" }).waitFor({ timeout: 45_000 });
    console.log(`CARD-MS ${Date.now() - inputAt}`);
    await page.waitForTimeout(3000);
  });
  await step(page, "09-competitors", started, async () => {
    await page.getByRole("button", { name: "That's me" }).click();
    await page.waitForURL(/\/onboarding\/competitors$/, { timeout: 15_000 });
    const listed = page
      .getByRole("list", { name: "Watching" })
      .getByRole("listitem")
      .or(page.getByRole("list", { name: "Possible competitors" }).getByRole("listitem"));
    await listed.first().waitFor({ timeout: 70_000 });
    console.log(`COMPETITORS-MS ${Date.now() - inputAt}`);
    await page.waitForTimeout(3000);
  });
  await step(page, "10-start-watching", started, async () => {
    const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
    if ((await watching.count()) === 0)
      await page
        .getByRole("button", { name: /^Watch / })
        .first()
        .click();
    await page.getByRole("button", { name: "Start watching" }).click();
    await page.waitForURL(/\/app$/, { timeout: 40_000 });
    console.log(`HOME-MS ${Date.now() - inputAt}`);
  });

  const pages: [string, string][] = [
    ["11-competitors", "/app/competitors"],
    ["12-alerts", "/app/alerts"],
    ["13-brief", "/app/brief"],
    ["14-settings", "/app/settings"],
    ["15-settings-agents", "/app/settings/agents"],
    ["16-not-found", "/app/nothing-here"],
  ];
  for (const [name, path] of pages) {
    await step(page, name, started, async () => {
      await page.goto(path);
    });
  }
  await step(page, "17-competitor-page", started, async () => {
    await page.goto("/app/competitors");
    await page.locator('a[href^="/app/competitors/"]').first().click();
    await page.waitForURL(/\/app\/competitors\/.+/);
  });
  await step(page, "18-upgrade", started, async () => {
    await page.goto("/app/upgrade");
  });

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of [
    ["20-phone-home", "/app"],
    ["21-phone-competitors", "/app/competitors"],
    ["22-phone-alerts", "/app/alerts"],
    ["23-phone-settings", "/app/settings"],
  ]) {
    await step(page, name, started, async () => {
      await page.goto(path);
    });
  }
  console.log(`CONSOLE ${JSON.stringify(errors.slice(0, 30))}`);
});
