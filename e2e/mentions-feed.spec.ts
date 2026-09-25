import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const TOKEN = "mention-feed-session-token";
const COOKIE = "__Secure-better-auth.session_token";

const SEED = `
INSERT OR IGNORE INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
VALUES ('user-mention-feed', 'Mention Reader', 'mention-feed@0509.io', 1, '2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z');

INSERT OR IGNORE INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
VALUES ('sess-mention-feed', '2027-09-25T00:00:00.000Z', '${TOKEN}', '2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z', 'user-mention-feed');

INSERT OR IGNORE INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
VALUES ('ws-mention-feed', 'Mention Feed', 'user-mention-feed', 'UTC', 1, 8, '2026-09-25T00:00:00.000Z');

INSERT OR IGNORE INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
VALUES
  ('ent-mention-self', 'ws-mention-feed', 'self', 'self-mention.example', 'Self Brand', '{}', 'manual', 'on', '2026-09-25T00:00:00.000Z'),
  ('ent-mention-on', 'ws-mention-feed', 'competitor', 'zephyrwear.example', 'Zephyrwear', '{}', 'manual', 'on', '2026-09-25T00:00:00.000Z'),
  ('ent-mention-off', 'ws-mention-feed', 'competitor', 'paused-mention.example', 'Paused Brand', '{}', 'manual', 'off', '2026-09-25T00:00:00.000Z');

INSERT OR IGNORE INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
VALUES ('src_mentions_medium', 'medium.tag_rss', 'mentions', 'medium', 'medium.tag_rss', 'rss', 1, '{}');

INSERT OR IGNORE INTO signal (
  id, workspace_id, entity_id, source_id, kind, title, canonical_url, url_hash, payload_json, dedup_key, published_at, observed_at
) VALUES
  ('sig-mention-news', 'ws-mention-feed', 'ent-mention-on', 'src_mentions_gdelt', 'mention',
   'Zephyrwear opens a London flagship', 'https://news.example/flagship', 'hash-news-flagship', '{}', 'ent-mention-on:flagship',
   '2026-09-24T08:00:00.000Z', '2026-09-25T09:00:00.000Z'),
  ('sig-mention-hn', 'ws-mention-feed', 'ent-mention-on', 'src_mentions_hn', 'mention',
   'Zephyrwear thread on Hacker News', 'https://news.ycombinator.com/item?id=1', 'hash-hn-thread', '{}', 'ent-mention-on:hn',
   '2026-09-25T07:00:00.000Z', '2026-09-25T08:00:00.000Z'),
  ('sig-mention-medium', 'ws-mention-feed', 'ent-mention-on', 'src_mentions_medium', 'mention',
   'Zephyrwear shows up in a roundup', 'https://medium.example/roundup', 'hash-medium-roundup', '{}', 'ent-mention-on:roundup',
   NULL, '2026-09-25T07:00:00.000Z'),
  ('sig-mention-held', 'ws-mention-feed', 'ent-mention-on', 'src_mentions_gdelt', 'mention',
   'Zephyrwear ticker line', 'https://news.example/ticker', 'hash-news-ticker', '{}', 'ent-mention-on:ticker',
   '2026-09-25T06:00:00.000Z', '2026-09-25T06:00:00.000Z'),
  ('sig-mention-off', 'ws-mention-feed', 'ent-mention-off', 'src_mentions_gdelt', 'mention',
   'Paused brand should stay hidden', 'https://news.example/paused', 'hash-news-paused', '{}', 'ent-mention-off:paused',
   '2026-09-25T06:00:00.000Z', '2026-09-25T06:00:00.000Z');

INSERT OR IGNORE INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, decided_at)
VALUES
  ('jev-mention-news', 'ws-mention-feed', 'mention_matters', 'hash-jev-news', 'sig-mention-news', 'ent-mention-on', 0.95, '2026-09-25T09:00:00.000Z'),
  ('jev-mention-hn', 'ws-mention-feed', 'mention_matters', 'hash-jev-hn', 'sig-mention-hn', 'ent-mention-on', 0.93, '2026-09-25T08:00:00.000Z'),
  ('jev-mention-medium', 'ws-mention-feed', 'mention_matters', 'hash-jev-medium', 'sig-mention-medium', 'ent-mention-on', 0.42, '2026-09-25T07:00:00.000Z'),
  ('jev-mention-held', 'ws-mention-feed', 'mention_matters', 'hash-jev-held', 'sig-mention-held', 'ent-mention-on', 0.05, '2026-09-25T06:00:00.000Z'),
  ('jev-mention-off', 'ws-mention-feed', 'mention_matters', 'hash-jev-off', 'sig-mention-off', 'ent-mention-off', 0.99, '2026-09-25T06:00:00.000Z');
`;

function authSecret(): string {
  const line = readFileSync(".dev.vars.example", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("BETTER_AUTH_SECRET="));
  if (line === undefined || line.length <= "BETTER_AUTH_SECRET=".length) {
    throw new Error("BETTER_AUTH_SECRET missing from .dev.vars.example");
  }
  return line.slice("BETTER_AUTH_SECRET=".length);
}

async function signedCookie(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
  const binary = String.fromCharCode(...signature);
  return `${token}.${btoa(binary)}`;
}

function seedWorkspace(): void {
  const file = join(tmpdir(), "mention-feed-seed.sql");
  writeFileSync(file, SEED);
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "0509", "--local", "--yes", `--file=${file}`],
    { stdio: "pipe" },
  );
}

async function measure(page: Page) {
  await page.addStyleTag({ content: "html, body { overflow-x: visible !important; }" });
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.beforeAll(() => {
  seedWorkspace();
});

test("a workspace shows the three mention treatments", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const value = await signedCookie(TOKEN, authSecret());
  await page.setExtraHTTPHeaders({ cookie: `${COOKIE}=${value}` });
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

  const before = await page.locator("main").innerHTML();
  expect(before).not.toMatch(/mention_matters|mention_is_about_brand|probability|confidence/i);

  await testInfo.attach(`alerts-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.getByTestId("mentions-show-all").click();
  await expect(held).toHaveCount(1);
  await expect(held).toContainText("Zephyrwear ticker line");
  await expect(page.getByText("Paused brand should stay hidden")).toHaveCount(0);
  const after = await page.locator("main").innerHTML();
  expect(after).not.toMatch(/mention_matters|mention_is_about_brand|probability|confidence/i);

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
