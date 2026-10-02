import { test, type Page } from "@playwright/test";

import { deleteCreatedAccount, requireInboxToken, settleSignInWidget, staleLinks, waitForMagicLink } from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  await deleteCreatedAccount(page, createdEmail).catch((e) =>
    console.log(`STEPFAIL cleanup ${String(e).slice(0, 200)}`),
  );
  createdEmail = "";
});

async function record(page: Page, name: string) {
  const info = await page.evaluate(() => ({
    url: location.pathname + location.search,
    h1: document.querySelector("h1")?.textContent?.trim() ?? "",
    text: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 1800),
  }));
  console.log(`STEP ${name} ${JSON.stringify(info)}`);
  const data = (await page.screenshot({ type: "jpeg", quality: 40, fullPage: true })).toString("base64");
  const parts = data.match(/.{1,3500}/g) ?? [];
  parts.forEach((part, i) => console.log(`SHOT ${name} ${i + 1}/${parts.length} ${part}`));
}

async function step(page: Page, name: string, action: () => Promise<unknown>, wait = 1500) {
  try {
    await action();
    await page.waitForTimeout(wait);
  } catch (error) {
    console.log(`STEPFAIL ${name} ${String(error).slice(0, 300)}`);
  }
  await record(page, name).catch((e) => console.log(`RECORDFAIL ${name} ${String(e).slice(0, 200)}`));
}

test("ux signin check @own-signin", async ({ page, context, browser }) => {
  test.setTimeout(600_000);
  const token = requireInboxToken();
  const email = `e2e+uxs${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}@0509.io`;
  createdEmail = email;
  console.log(`ACCOUNT ${email}`);
  await page.setViewportSize({ width: 1440, height: 900 });

  await step(page, "s01-login", () => page.goto("/login"));
  await step(page, "s02-bad-email", async () => {
    await page.locator('input[name="email"]').fill("not-an-email");
    await page.locator('button[type="submit"]').click();
  });
  await step(page, "s03-bogus-link", () => page.goto("/api/auth/magic-link/verify?token=bogus&callbackURL=/app"));

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = (await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })) as { authenticatorId: string };

  await step(
    page,
    "s04-passkey-none-registered",
    async () => {
      await page.goto("/login");
      await page.getByRole("button", { name: /use a passkey instead/i }).click();
    },
    4000,
  );

  const dirty = `  ${email.toUpperCase().replace("E2E+", "E2E+")} `;
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(dirty);
  console.log(`TYPED ${JSON.stringify(await page.locator('input[name="email"]').inputValue())}`);
  await settleSignInWidget(page);
  const stale = await staleLinks(email, token);
  await page.locator('button[type="submit"]').click();
  await page.getByRole("heading", { level: 1, name: "Check your email" }).waitFor({ timeout: 30000 });
  await record(page, "s04b-sent-state");
  const link = await waitForMagicLink(email, token, stale);
  await page.goto(link);
  await page.waitForTimeout(2000);
  await record(page, "s05-after-link-landing");

  await step(page, "s06-login-while-signed-in", () => page.goto("/login"));
  await step(page, "s07-settings", () => page.goto("/app/settings"));
  await step(page, "s08-add-passkey", () => page.getByRole("button", { name: "Add a passkey" }).click(), 3000);
  await step(page, "s09-add-passkey-again", () => page.getByRole("button", { name: "Add a passkey" }).click(), 3000);
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
  await step(
    page,
    "s10-add-passkey-unverified",
    () => page.getByRole("button", { name: "Add a passkey" }).click(),
    6000,
  );
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true });
  const list = await page.evaluate(async () => {
    const r = await fetch("/api/auth/passkey/list-user-passkeys");
    return { status: r.status, body: (await r.text()).slice(0, 600) };
  });
  console.log(`STEP s11-list-api ${JSON.stringify(list)}`);

  await step(page, "s12-sign-out", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  });
  await step(
    page,
    "s13-back-button",
    async () => {
      await page.goBack();
    },
    3000,
  );
  await step(page, "s14-goto-app-after-signout", () => page.goto("/app"));

  const replay = await browser.newContext({ storageState: await context.storageState() });
  const rp = await replay.newPage();
  await rp.goto(link);
  await rp.waitForTimeout(1500);
  await record(rp, "s15-link-opened-twice");
  await replay.close();

  await step(
    page,
    "s16-passkey-signin",
    async () => {
      await page.goto("/login");
      await page.getByRole("button", { name: /use a passkey instead/i }).click();
      await page.waitForURL(/\/app|\/onboarding/, { timeout: 15000 });
    },
    3000,
  );

  const del = await page.evaluate(async () => {
    const r = await fetch("/api/auth/passkey/list-user-passkeys");
    const items = (await r.json()) as { id: string }[];
    const out: number[] = [];
    for (const p of items) {
      const d = await fetch("/api/auth/passkey/delete-passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: p.id }),
      });
      out.push(d.status);
    }
    return { count: items.length, out };
  });
  console.log(`STEP s17-deleted ${JSON.stringify(del)}`);
  await step(page, "s18-settings-after-remove", () => page.goto("/app/settings"));
  await step(page, "s19-signout", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  });
  await step(
    page,
    "s20-passkey-after-removal",
    async () => {
      await page.getByRole("button", { name: /use a passkey instead/i }).click();
    },
    6000,
  );
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined);
  await page.goto(link).catch(() => undefined);
  await page.goto("/login");
});
