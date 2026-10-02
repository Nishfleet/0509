import { test, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

async function audit(page: Page, name: string) {
  const info = await page.evaluate(() => {
    const vw = window.innerWidth;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}]`;
    const small = [...document.querySelectorAll("a[href],button,input,select,textarea,[role=switch],[role=button]")]
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 44 || r.width < 44)
      .map(({ el, r }) => `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    const beyond = [...document.querySelectorAll("body *")]
      .filter(visible)
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .slice(0, 8)
      .map((el) => `${label(el)} right=${Math.round(el.getBoundingClientRect().right)}`);
    const clipped = [...document.querySelectorAll("body *")]
      .filter(visible)
      .filter((el) => {
        const s = getComputedStyle(el);
        return (
          (s.overflowX === "hidden" || s.textOverflow === "ellipsis") &&
          el.scrollWidth > el.clientWidth + 1 &&
          (el.textContent ?? "").trim().length > 0
        );
      })
      .slice(0, 8)
      .map((el) => `${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
    const tiny = [...document.querySelectorAll("body *")]
      .filter(visible)
      .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
      .slice(0, 8)
      .map((el) => `${label(el)} ${getComputedStyle(el).fontSize}`);
    return {
      url: location.pathname,
      h1: document.querySelector("h1")?.textContent?.trim() ?? "",
      overflow: document.documentElement.scrollWidth - vw,
      small: small.slice(0, 40),
      smallCount: small.length,
      beyond,
      clipped,
      tiny,
      text: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 900),
    };
  });
  console.log(`STEP ${name} ${JSON.stringify(info)}`);
  const data = (await page.screenshot({ type: "jpeg", quality: 45, fullPage: true })).toString("base64");
  const parts = data.match(/.{1,3500}/g) ?? [];
  parts.forEach((part, i) => console.log(`SHOT ${name} ${i + 1}/${parts.length} ${part}`));
}

async function visit(page: Page, name: string, action: () => Promise<void>) {
  try {
    await action();
    await page.waitForTimeout(1500);
  } catch (error) {
    console.log(`STEPFAIL ${name} ${String(error).slice(0, 300)}`);
  }
  await audit(page, name).catch((error) => console.log(`RECORDFAIL ${name} ${String(error).slice(0, 200)}`));
}

test("ux phone walkthrough @own-signin", async ({ page }) => {
  test.setTimeout(900_000);
  const token = requireInboxToken();
  const email = `e2e+uxp${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}@0509.io`;
  console.log(`ACCOUNT ${email}`);
  await page.setViewportSize({ width: 390, height: 844 });

  await signInWithMagicLink(page, email, token);
  await visit(page, "p01-after-signin", async () => {});
  await page.goto("/onboarding");
  await visit(page, "p02-onboarding", async () => {});
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("allbirds.com");
  await input.press("Enter");
  await page.getByRole("button", { name: "That's me" }).click({ timeout: 45_000 });
  await visit(page, "p03-identity-done", async () => {});
  await page.waitForURL(/\/onboarding\/competitors$/);
  await page
    .getByRole("list", { name: "Possible competitors" })
    .getByRole("listitem")
    .or(page.getByRole("list", { name: "Watching" }).getByRole("listitem"))
    .first()
    .waitFor({ timeout: 70_000 });
  await page.waitForTimeout(6000);
  await visit(page, "p04-onboarding-competitors", async () => {});
  const watchButtons = page.getByRole("button", { name: /^Watch / });
  if ((await watchButtons.count()) > 0) await watchButtons.first().click();
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.waitForURL(/\/app$/, { timeout: 40_000 });
  await page.waitForTimeout(5000);

  await visit(page, "p05-home", async () => {
    await page.goto("/app");
  });
  await visit(page, "p06-competitors", async () => {
    await page.goto("/app/competitors");
  });
  await visit(page, "p07-competitor", async () => {
    await page.locator('a[href^="/app/competitors/"]').first().click();
    await page.waitForURL(/\/app\/competitors\/.+/);
  });
  await visit(page, "p08-alerts", async () => {
    await page.goto("/app/alerts");
  });
  await visit(page, "p09-brief", async () => {
    await page.goto("/app/brief");
  });
  await visit(page, "p10-settings", async () => {
    await page.goto("/app/settings");
  });
  await visit(page, "p11-agents", async () => {
    await page.goto("/app/settings/agents");
  });
  await visit(page, "p12-upgrade", async () => {
    const response = await page.request.get("/app/upgrade", { maxRedirects: 0 });
    console.log(`UPGRADE status=${response.status()} location=${response.headers()["location"]?.slice(0, 80)}`);
    await page.goto("/app/upgrade").catch(() => undefined);
  });
  await visit(page, "p13-menu-open", async () => {
    await page.goto("/app");
    const menu = page.getByRole("button", { name: /menu/i }).first();
    if ((await menu.count()) > 0) await menu.click();
  });
  await visit(page, "p14-landing", async () => {
    await page.goto("/");
  });
  await visit(page, "p15-delete", async () => {
    await page.goto("/app/settings");
    await page.getByLabel("Type " + email + " to confirm").fill(email);
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.waitForURL(/\/login\?deleted=/);
  });
});
