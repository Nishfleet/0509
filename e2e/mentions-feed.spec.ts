import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { expect, test, type Page } from "@playwright/test";

const BANNED = /mention_matters|mention_is_about_brand|probability|confidence/i;

test.skip(
  Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL),
  "the three treatments are rows in the local preview database; production signs in through the magic-link inbox and has no fixture workspace",
);

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
      const row = probe.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'signal'").get();
      if (row !== undefined) return file;
    } finally {
      probe.close();
    }
  }
  throw new Error("local preview D1 has no signal table");
}

function run(db: DatabaseSync, sql: string, ...values: (string | number | null)[]): void {
  db.prepare(sql).run(...values);
}

async function seedSession(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `mention-feed-${suffix}@0509.io`;
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
    const onId = `ent-on-${suffix}`;
    const offId = `ent-off-${suffix}`;
    const sourceId = `src-medium-${suffix}`;
    const stamp = "2026-09-25T00:00:00.000Z";
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      workspaceId,
      "Mention Feed",
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
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, 'Zephyrwear', ?)",
      onId,
      workspaceId,
      `zephyr-${suffix}.example`,
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
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?, ?, 'mentions', 'medium', ?, 'rss', 1, '{}')",
      sourceId,
      `medium.feed-${suffix}`,
      `medium.feed-${suffix}`,
    );
    const mention = (
      id: string,
      entityId: string,
      source: string,
      title: string,
      url: string,
      publishedAt: string | null,
      observedAt: string,
    ) =>
      run(
        db,
        `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, payload_json, dedup_key, published_at, observed_at)
         VALUES (?, ?, ?, ?, 'mention', ?, ?, ?, ?, '{}', ?, ?, ?)`,
        id,
        workspaceId,
        entityId,
        source,
        title,
        url,
        url,
        `hash-${id}`,
        `dedup-${id}`,
        publishedAt,
        observedAt,
      );
    const verdict = (id: string, signalId: string, entityId: string, p: number, reason: string, decidedAt: string) =>
      run(
        db,
        `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, reason, decided_at)
         VALUES (?, ?, 'mention_matters', ?, ?, ?, ?, ?, ?)`,
        id,
        workspaceId,
        `hash-${id}`,
        signalId,
        entityId,
        p,
        reason,
        decidedAt,
      );
    mention(
      `sig-news-${suffix}`,
      onId,
      "src_mentions_gdelt",
      "Zephyrwear opens a London flagship",
      "https://news.example/flagship",
      "2026-09-24T08:00:00.000Z",
      "2026-09-25T09:00:00.000Z",
    );
    mention(
      `sig-hn-${suffix}`,
      onId,
      "src_mentions_hn",
      "Zephyrwear thread on Hacker News",
      "https://news.ycombinator.com/item?id=1",
      "2026-09-25T07:00:00.000Z",
      "2026-09-25T08:00:00.000Z",
    );
    mention(
      `sig-medium-${suffix}`,
      onId,
      sourceId,
      "Zephyrwear shows up in a roundup",
      "https://medium.example/roundup",
      null,
      "2026-09-25T07:00:00.000Z",
    );
    mention(
      `sig-held-${suffix}`,
      onId,
      "src_mentions_gdelt",
      "Zephyrwear ticker line",
      "https://news.example/ticker",
      "2026-09-25T06:00:00.000Z",
      "2026-09-25T06:00:00.000Z",
    );
    mention(
      `sig-off-${suffix}`,
      offId,
      "src_mentions_gdelt",
      "Paused brand should stay hidden",
      "https://news.example/paused",
      "2026-09-25T06:00:00.000Z",
      "2026-09-25T06:00:00.000Z",
    );
    verdict(
      `jev-news-old-${suffix}`,
      `sig-news-${suffix}`,
      onId,
      0.04,
      "An old read that should stay hidden.",
      "2026-09-25T08:00:00.000Z",
    );
    verdict(
      `jev-news-${suffix}`,
      `sig-news-${suffix}`,
      onId,
      0.95,
      "A London flagship is a move worth knowing.",
      "2026-09-25T09:00:00.000Z",
    );
    verdict(
      `jev-hn-${suffix}`,
      `sig-hn-${suffix}`,
      onId,
      0.93,
      "A public thread about the brand is worth a look.",
      "2026-09-25T08:00:00.000Z",
    );
    verdict(
      `jev-medium-${suffix}`,
      `sig-medium-${suffix}`,
      onId,
      0.42,
      "A roundup mention, not a move of its own.",
      "2026-09-25T07:00:00.000Z",
    );
    verdict(`jev-held-${suffix}`, `sig-held-${suffix}`, onId, 0.05, "A ticker line, not a move.", "2026-09-25T06:00:00.000Z");
    verdict(`jev-off-${suffix}`, `sig-off-${suffix}`, offId, 0.99, "Paused brand reason.", "2026-09-25T06:00:00.000Z");
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return cookie;
  } finally {
    db.close();
  }
}

async function measure(page: Page) {
  await page.addStyleTag({ content: "html, body { overflow-x: visible !important; }" });
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test("a workspace shows the three mention treatments", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setExtraHTTPHeaders({ cookie: await seedSession() });
  const response = await page.goto("/app/alerts");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/app\/alerts/);
  await expect(page.getByTestId("alerts-contract")).toBeVisible();

  const shown = page.locator('[data-testid="mention-row"][data-treatment="shown"]');
  const possibly = page.locator('[data-testid="mention-row"][data-treatment="possibly"]');
  const held = page.locator('[data-testid="mention-row"][data-treatment="held"]');
  await expect(shown).toHaveCount(2);
  await expect(possibly).toHaveCount(1);
  await expect(held).toHaveCount(0);
  await expect(possibly).toContainText("Possibly. We were not sure this mattered");
  await expect(possibly).toContainText("found today");
  await expect(page.getByText("News mentions", { exact: true })).toBeVisible();
  await expect(page.getByText("Hacker News mentions", { exact: true })).toBeVisible();
  await expect(page.getByText("Medium mentions", { exact: true })).toBeVisible();
  await expect(page.getByText("Paused brand should stay hidden")).toHaveCount(0);
  await expect(page.getByText("An old read that should stay hidden.")).toHaveCount(0);

  const before = await page.locator("main").innerHTML();
  expect(before).not.toMatch(BANNED);

  await testInfo.attach(`alerts-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.getByTestId("mentions-show-all").click();
  await expect(held).toHaveCount(1);
  await expect(held).toContainText("Zephyrwear ticker line");
  const trigger = held.getByRole("button", { name: "Why we flagged this" });
  await trigger.click();
  await expect(page.getByTestId("why-flagged-reason")).toHaveText("Our read: A ticker line, not a move.");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("why-flagged")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByText("Paused brand should stay hidden")).toHaveCount(0);
  const after = await page.locator("main").innerHTML();
  expect(after).not.toMatch(BANNED);

  await testInfo.attach(`alerts-show-all-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  if (testInfo.project.name === "phone-390") {
    const widths = await measure(page);
    expect(widths.scrollWidth, JSON.stringify(widths)).toBe(widths.clientWidth);
  }

  expect(consoleErrors).toEqual([]);
});
