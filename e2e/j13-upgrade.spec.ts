import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { expect, test, type Page } from "@playwright/test";
import { Webhook } from "standardwebhooks";

import {
  consoleFailures,
  deleteCreatedAccount,
  isLocalLane,
  laneOrigin,
  requireInboxToken,
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

function previewDatabasePath(): string {
  const root = ".wrangler/state";
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".sqlite"));
  for (const name of files) {
    const file = join(root, name);
    const probe = new DatabaseSync(file, { readOnly: true, timeout: 15_000 });
    try {
      const row = probe.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'entity'").get();
      if (row !== undefined) return file;
    } finally {
      probe.close();
    }
  }
  throw new Error("local preview D1 has no entity table");
}

async function seedPreviewWorkspace(
  label: string,
  competitors: number,
): Promise<{ cookie: string; workspaceId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `${label}-${suffix}@0509.io`;
  const db = new DatabaseSync(previewDatabasePath(), { timeout: 15_000 });
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec("PRAGMA foreign_keys = ON");
  const links: string[] = [];
  const auth = betterAuth({
    database: db,
    secret: devVar("BETTER_AUTH_SECRET"),
    baseURL: laneOrigin(),
    advanced: { cookiePrefix: "better-auth" },
    plugins: [
      magicLink({
        expiresIn: 300,
        sendMagicLink: ({ url }) => {
          links.push(url);
          return Promise.resolve();
        },
      }),
    ],
  });
  try {
    await auth.api.signInMagicLink({ body: { email }, headers: new Headers() });
    const link = links.at(-1);
    if (link === undefined) throw new Error("magic link was not issued");
    const response = await auth.handler(new Request(link, { redirect: "manual" }));
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");
    if (cookie === "") throw new Error("magic link created no session cookie");
    const user = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email) as { id: string } | undefined;
    if (user === undefined) throw new Error("magic link created no user");
    const stamp = "2026-09-27T00:00:00.000Z";
    const workspaceId = `ws-${suffix}`;
    db.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    ).run(workspaceId, label, user.id, stamp);
    db.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    ).run(`ent-self-${suffix}`, workspaceId, `self-${suffix}.example`, stamp);
    for (let index = 0; index < competitors; index += 1) {
      db.prepare(
        "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, ?, ?)",
      ).run(
        `ent-${suffix}-${String(index)}`,
        workspaceId,
        `rival${String(index)}-${suffix}.example`,
        `Rival ${String(index)}`,
        stamp,
      );
    }
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return { cookie, workspaceId };
  } finally {
    db.close();
  }
}

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
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 10_000 });
  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(watching.first().or(page.getByRole("button", { name: /^Watch / }).first())).toBeVisible({
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
