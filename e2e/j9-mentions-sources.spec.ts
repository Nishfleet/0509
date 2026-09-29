import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { expect, test } from "@playwright/test";

import { consoleFailures, watchConsole } from "./inbox";

test.skip(
  Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL),
  "the three sources are rows in the local preview database; production signs in through the magic-link inbox and has no fixture workspace",
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
  const email = `j9-mentions-${suffix}@0509.io`;
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
    const stamp = "2026-09-25T00:00:00.000Z";
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      workspaceId,
      "J9 Mentions",
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
    const mention = (id: string, source: string, title: string, url: string, tombstoned: number) => {
      run(
        db,
        `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, payload_json, dedup_key, published_at, observed_at, is_tombstoned)
         VALUES (?, ?, ?, ?, 'mention', ?, ?, ?, ?, '{}', ?, ?, ?, ?)`,
        id,
        workspaceId,
        onId,
        source,
        title,
        url,
        url,
        `hash-${id}`,
        `dedup-${id}`,
        "2026-09-25T07:00:00.000Z",
        "2026-09-25T09:00:00.000Z",
        tombstoned,
      );
      run(
        db,
        `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, reason, decided_at)
         VALUES (?, ?, 'mention_matters', ?, ?, ?, 0.95, 'A move worth knowing.', ?)`,
        `jev-${id}`,
        workspaceId,
        `hash-${id}`,
        id,
        onId,
        "2026-09-25T09:00:00.000Z",
      );
    };
    mention(`sig-news-${suffix}`, "src_mentions_gdelt", "Zephyrwear opens a London flagship", "https://news.example/flagship", 0);
    mention(`sig-hn-${suffix}`, "src_mentions_hn", "Zephyrwear raises a Series B", "https://news.ycombinator.com/item?id=9", 0);
    mention(`sig-yt-${suffix}`, "src_mentions_youtube", "Zephyrwear autumn campaign film", "https://www.youtube.com/watch?v=QVx0PY1lf-s", 0);
    mention(`sig-homonym-${suffix}`, "src_mentions_gdelt", "Zephyr winds expected this weekend", "https://weather.example/winds", 1);
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    return cookie;
  } finally {
    db.close();
  }
}

test("J9: news, Hacker News and YouTube mentions are listed and the homonym is not", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const watched = watchConsole(page);

  await page.setExtraHTTPHeaders({ cookie: await seedSession() });
  const response = await page.goto("/app/alerts");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("alerts-contract")).toBeVisible();

  const rows = page.getByTestId("mention-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Zephyrwear opens a London flagship" }).getByTestId("mention-source")).toHaveText("News mentions");
  await expect(rows.filter({ hasText: "Zephyrwear raises a Series B" }).getByTestId("mention-source")).toHaveText("Hacker News mentions");
  await expect(rows.filter({ hasText: "Zephyrwear autumn campaign film" }).getByTestId("mention-source")).toHaveText("YouTube mentions");
  await expect(page.getByText("Zephyr winds expected this weekend")).toHaveCount(0);

  await testInfo.attach(`j9-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
