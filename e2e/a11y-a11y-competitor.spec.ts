import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function authSecret(): string {
  const line = readFileSync(".dev.vars.example", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("BETTER_AUTH_SECRET="));
  if (line === undefined || line.length <= "BETTER_AUTH_SECRET=".length) {
    throw new Error("BETTER_AUTH_SECRET missing from .dev.vars.example");
  }
  return line.slice("BETTER_AUTH_SECRET=".length);
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

function run(db: DatabaseSync, sql: string, ...values: (string | number | null)[]): void {
  db.prepare(sql).run(...values);
}

async function seedCompetitor(): Promise<{ cookie: string; entityId: string; name: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `a11y-competitor-${suffix}@0509.io`;
  const name = "Zephyrwear";
  const db = new DatabaseSync(previewDatabasePath(), { timeout: 15_000 });
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec("PRAGMA foreign_keys = ON");
  const links: string[] = [];
  const auth = betterAuth({
    database: db,
    secret: authSecret(),
    baseURL: "https://0509.io",
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
    const workspaceId = `ws-${suffix}`;
    const entityId = `ent-on-${suffix}`;
    const offId = `ent-off-${suffix}`;
    const sourceId = `src-web-${suffix}`;
    const stamp = new Date().toISOString();
    const week = "2026-09-21T00:00:00.000Z";
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      workspaceId,
      "A11y Competitor",
      user.id,
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
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, ?, ?)",
      entityId,
      workspaceId,
      `zephyr-${suffix}.example`,
      name,
      stamp,
    );
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, 'Paused Brand', 'off', ?)",
      offId,
      workspaceId,
      `paused-${suffix}.example`,
      stamp,
    );
    run(
      db,
      "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, computed_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
      `st-on-${suffix}`,
      workspaceId,
      entityId,
      week,
      stamp,
    );
    run(
      db,
      "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, computed_at) VALUES (?, ?, ?, ?, 0, 2, ?)",
      `st-off-${suffix}`,
      workspaceId,
      offId,
      week,
      stamp,
    );
    run(
      db,
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?, ?, 'mentions', 'web', ?, 'rss', 1, '{}')",
      sourceId,
      `web.feed-${suffix}`,
      `web.feed-${suffix}`,
    );
    run(
      db,
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, payload_json, dedup_key, observed_at)
       VALUES (?, ?, ?, ?, 'mention', ?, ?, ?, ?, '{}', ?, ?)`,
      `sig-${suffix}`,
      workspaceId,
      entityId,
      sourceId,
      "Zephyrwear opens a second store",
      `https://news.example/${suffix}`,
      `https://news.example/${suffix}`,
      `hash-${suffix}`,
      `dedup-${suffix}`,
      stamp,
    );
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return { cookie, entityId, name };
  } finally {
    db.close();
  }
}

async function scan(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  await testInfo.attach(label, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  expect(results.violations).toEqual([]);
}

async function landmarksAndContrast(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Places" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBe(0);

      if (viewport.width === 390) {
        const feed = await page.locator("[data-section='developments']").boundingBox();
        const rail = await page.locator("[data-slot='competitor-rail']").boundingBox();
        expect(feed).not.toBeNull();
        expect(rail).not.toBeNull();
        expect(rail?.y ?? 0).toBeGreaterThan((feed?.y ?? 0) + (feed?.height ?? 0) - 1);
      }

      await scan(page, testInfo, `competitor-${String(viewport.width)}-${colorScheme}`);
    }
  }
}

async function keyboard(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  const order: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab");
    order.push((await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "")).replace(/\s+/g, " "));
  }
  expect(order).toEqual(["Home", "Competitors", "Alerts", "Settings"]);
  await expect(page.getByRole("navigation", { name: "Places" }).getByRole("link", { name: "Settings" })).toHaveCSS(
    "outline-style",
    "solid",
  );

  const tracking = page.getByRole("switch", { name: `${name} tracking` });
  for (let i = 0; i < 30; i += 1) {
    if (await tracking.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(tracking).toBeFocused();
  await expect(tracking).toHaveCSS("outline-style", "solid");
  await page.screenshot({
    path: testInfo.outputPath("competitor-focus-switch.png"),
  });

  const chips = page.getByRole("group", { name: "Filter developments" });
  await expect(chips).toBeVisible();
  const all = chips.getByRole("button", { name: /^All/ });
  await all.focus();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  const ads = chips.getByRole("button", { name: /^Ads/ });
  await expect(ads).toBeFocused();
  await page.keyboard.press("Space");
  await expect(ads).toHaveAttribute("aria-pressed", "true");
  await expect(ads).toHaveCSS("outline-style", "solid");
  await page.screenshot({
    path: testInfo.outputPath("competitor-focus-chip.png"),
  });
  await expect(page.getByRole("navigation", { name: "Peers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Paused Brand · off" })).toBeVisible();
}

test("a competitor page passes axe at 1440 and 390 in light and dark and is keyboard operable", async ({
  page,
}, testInfo) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL),
    "the seeded competitor page is a row in the local preview database; production signs in through the magic-link inbox",
  );
  test.setTimeout(120_000);
  const { cookie, entityId, name } = await seedCompetitor();
  await page.setExtraHTTPHeaders({ cookie });
  const response = await page.goto(`/app/competitors/${entityId}`);
  expect(response?.status()).toBe(200);
  await landmarksAndContrast(page, testInfo, name);
  await keyboard(page, testInfo, name);
});

test("production competitor page passes axe at 1440 and 390 in light and dark", async ({ page }, testInfo) => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "production axe needs a signed-in session; the preview lane cannot read the magic-link inbox",
  );
  test.setTimeout(180_000);
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());
  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("nike.com");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "That's me" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/);
  await page.getByLabel("Add one we missed").fill("allbirds.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("allbirds.com")).toBeVisible();
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
  await page.goto("/app/competitors");
  await page.getByRole("list", { name: "Competitors" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/app\/competitors\/[^/]+$/);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  const name = (await heading.textContent())?.trim() ?? "";
  expect(name).not.toBe("");
  await landmarksAndContrast(page, testInfo, name);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  const order: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab");
    order.push((await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "")).replace(/\s+/g, " "));
  }
  expect(order).toEqual(["Home", "Competitors", "Alerts", "Settings"]);
  const tracking = page.getByRole("switch", { name: `${name} tracking` });
  for (let i = 0; i < 30; i += 1) {
    if (await tracking.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(tracking).toBeFocused();
  await expect(tracking).toHaveCSS("outline-style", "solid");
  await page.screenshot({ path: testInfo.outputPath("competitor-focus-switch-production.png") });
});
