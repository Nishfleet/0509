import { expect, test, type Page } from "@playwright/test";
import { Webhook } from "standardwebhooks";

import {
  consoleFailures,
  deleteCreatedAccount,
  isLocalLane,
  requireInboxToken,
  signInWithMagicLink,
  watchConsole,
} from "./inbox";
import { devVar, seedPreviewWorkspace } from "./preview-session";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  await deleteCreatedAccount(page, createdEmail);
  createdEmail = "";
});

const PREVIEW_STARTER_PRODUCT = "pdt_preview_starter";

async function addUntilCap(page: Page): Promise<void> {
  const cap = page.getByText(/Your plan watches up to 5 competitors/);
  const list = page.getByRole("list", { name: "Competitors" });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await cap.isVisible()) return;
    const domain = `j13${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}.com`;
    await page.getByLabel("Add one we missed").fill(domain);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(list.getByRole("link", { name: domain }).or(cap)).toBeVisible();
  }
  await expect(cap).toBeVisible();
}

async function watchOneCompetitor(page: Page): Promise<void> {
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;
  await signInWithMagicLink(page, email, requireInboxToken());
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("gymshark.com");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 30_000 });
  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(watching.first().or(page.getByRole("button", { name: /^Watch / }).first())).toBeVisible({
    timeout: 60_000,
  });
  if ((await watching.count()) === 0) {
    await page.getByRole("button", { name: /^Watch / }).first().click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function payAtDodoTestCheckout(page: Page): Promise<void> {
  await page.waitForURL(/checkout\.dodopayments\.com/, { timeout: 30_000 });
  await page.getByPlaceholder(/card number|1234 1234 1234 1234/i).fill("4242424242424242");
  await page.getByPlaceholder(/MM ?\/ ?YY/i).fill("06/32");
  await page.getByPlaceholder(/cvc|cvv|security code/i).fill("123");
  await page.getByRole("button", { name: /subscribe|start trial|pay|confirm/i }).click();
  await page.waitForURL(/\/app\/competitors\?.*upgraded=starter/, { timeout: 120_000 });
}

async function deliverPreviewWebhook(page: Page, workspaceId: string): Promise<void> {
  const id = `evt_j13_${crypto.randomUUID()}`;
  const body = JSON.stringify({
    type: "subscription.active",
    timestamp: new Date().toISOString(),
    data: {
      subscription_id: `sub_${workspaceId}`,
      product_id: PREVIEW_STARTER_PRODUCT,
      status: "active",
      next_billing_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      customer: { customer_id: `cus_${workspaceId}` },
      metadata: { workspace_id: workspaceId, plan: "starter" },
    },
  });
  const signedAt = new Date();
  const response = await page.request.post("/api/webhooks/dodo", {
    data: body,
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(signedAt.getTime() / 1000)),
      "webhook-signature": new Webhook(devVar("DODO_WEBHOOK_SECRET")).sign(id, signedAt, body),
    },
  });
  expect(response.status()).toBe(200);
}

test("J13: the plan gate upgrades a workspace and the page flips without a reload @own-signin", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const watched = watchConsole(page);
  let workspaceId = "";

  if (isLocalLane()) {
    const seeded = await seedPreviewWorkspace("j13-upgrade", 5);
    workspaceId = seeded.workspaceId;
    await page.setExtraHTTPHeaders({ cookie: seeded.cookie });
    await page.goto("/app/competitors?upgraded=starter");
    await expect(page.getByText(/Confirming your Starter plan/)).toBeVisible();
  } else {
    await watchOneCompetitor(page);
    await page.goto("/app/competitors");
  }

  await addUntilCap(page);
  const upgrade = page.getByRole("button", { name: /^Upgrade to Starter\s*€46\/mo$/ });
  await expect(upgrade).toBeVisible();
  await expect(page.getByText("Starter watches up to 15 competitors.")).toBeVisible();

  if (isLocalLane()) {
    await page.evaluate(() => {
      Object.assign(window, { j13NoReload: true });
    });
    await deliverPreviewWebhook(page, workspaceId);
  } else {
    await upgrade.click();
    await payAtDodoTestCheckout(page);
    console.log(`J13 return url=${page.url()}`);
    await page.evaluate(() => {
      Object.assign(window, { j13NoReload: true });
    });
  }

  await expect(page.getByText(/You're on Starter\. It watches up to 15 competitors\./)).toBeVisible({
    timeout: isLocalLane() ? 15_000 : 120_000,
  });
  expect(await page.evaluate(() => "j13NoReload" in window)).toBe(true);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
