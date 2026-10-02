import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { Webhook } from "standardwebhooks";

import {
  consoleFailures,
  deleteCreatedAccount,
  isLocalLane,
  requireInboxToken,
  run,
  seedPreviewSession,
  signInWithMagicLink,
  watchConsole,
} from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  await deleteCreatedAccount(page, createdEmail);
  createdEmail = "";
});

function devVar(name: string): string {
  const line = readFileSync(".dev.vars.example", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${name}=`));
  if (line === undefined || line.length <= name.length + 1) throw new Error(`${name} missing from .dev.vars.example`);
  return line.slice(name.length + 1);
}

async function seedPreviewWorkspace(
  label: string,
  competitors: number,
): Promise<{ cookie: string; workspaceId: string }> {
  const { cookie, seeded } = await seedPreviewSession(label, ({ db, suffix, userId }) => {
    const stamp = "2026-09-27T00:00:00.000Z";
    const workspaceId = `ws-${suffix}`;
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      workspaceId,
      label,
      userId,
      stamp,
    );
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
      `ent-self-${suffix}`,
      workspaceId,
      `self-${suffix}.example`,
      stamp,
    );
    for (let index = 0; index < competitors; index += 1) {
      run(
        db,
        "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, ?, ?)",
        `ent-${suffix}-${String(index)}`,
        workspaceId,
        `rival${String(index)}-${suffix}.example`,
        `Rival ${String(index)}`,
        stamp,
      );
    }
    return workspaceId;
  });
  return { cookie, workspaceId: seeded };
}

const PREVIEW_STARTER_PRODUCT = "pdt_preview_starter";

async function addUntilCap(page: Page): Promise<void> {
  const cap = page.getByText(/Your plan watches up to 5 competitors/);
  const list = page.getByRole("list", { name: "Competitors", exact: true });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await cap.isVisible()) return;
    const domain = `j13${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}.com`;
    await page.getByLabel("Add a competitor we missed").fill(domain);
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
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  await input.fill("gymshark.com");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(
    watching
      .first()
      .or(page.getByRole("button", { name: /^Watch / }).first())
      .first(),
  ).toBeVisible({
    timeout: 60_000,
  });
  if ((await watching.count()) === 0) {
    await page
      .getByRole("button", { name: /^Watch / })
      .first()
      .click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
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

test("J13: the plan gate upgrades a workspace and the page flips without a reload @own-signin", async ({
  page,
}, testInfo) => {
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

  if (!isLocalLane()) {
    await upgrade.click();
    await page.waitForURL(/checkout\.dodopayments\.com/, { timeout: 30_000 });
    console.log(`J13 stopped at Dodo hosted checkout, no payment made: ${new URL(page.url()).origin}`);
    return;
  }

  await page.evaluate(() => {
    Object.assign(window, { j13NoReload: true });
  });
  await deliverPreviewWebhook(page, workspaceId);
  await expect(page.getByText(/You're on Starter\. It watches up to 15 competitors\./)).toBeVisible({
    timeout: 15_000,
  });
  expect(await page.evaluate(() => "j13NoReload" in window)).toBe(true);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
