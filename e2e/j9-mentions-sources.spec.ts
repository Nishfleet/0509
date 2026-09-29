import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";

import { consoleFailures, watchConsole } from "./inbox";
import { run, seedPreviewSession } from "./preview-session";

test.skip(
  Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL),
  "the three sources are rows in the local preview database; production signs in through the magic-link inbox and has no fixture workspace",
);

function seed({
  db,
  suffix,
  userId,
}: {
  db: DatabaseSync;
  suffix: string;
  userId: string;
}): void {
  const workspaceId = `ws-${suffix}`;
  const onId = `ent-on-${suffix}`;
  const stamp = "2026-09-25T00:00:00.000Z";
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "J9 Mentions",
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
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, 'Zephyrwear', ?)",
    onId,
    workspaceId,
    `zephyr-${suffix}.example`,
    stamp,
  );
  const mention = (
    id: string,
    source: string,
    title: string,
    url: string,
    tombstoned: number,
  ) => {
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
  mention(
    `sig-news-${suffix}`,
    "src_mentions_gdelt",
    "Zephyrwear opens a London flagship",
    "https://news.example/flagship",
    0,
  );
  mention(
    `sig-hn-${suffix}`,
    "src_mentions_hn",
    "Zephyrwear raises a Series B",
    "https://news.ycombinator.com/item?id=9",
    0,
  );
  mention(
    `sig-yt-${suffix}`,
    "src_mentions_youtube",
    "Zephyrwear autumn campaign film",
    "https://www.youtube.com/watch?v=QVx0PY1lf-s",
    0,
  );
  mention(
    `sig-homonym-${suffix}`,
    "src_mentions_gdelt",
    "Zephyr winds expected this weekend",
    "https://weather.example/winds",
    1,
  );
}

function seedSession(): Promise<string> {
  return seedPreviewSession("j9-mentions", seed);
}

test("J9: news, Hacker News and YouTube mentions are listed and the homonym is not", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const watched = watchConsole(page);

  await page.setExtraHTTPHeaders({ cookie: await seedSession() });
  const response = await page.goto("/app/alerts");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("alerts-contract")).toBeVisible();

  const rows = page.getByTestId("mention-row");
  await expect(rows).toHaveCount(3);
  await expect(
    rows
      .filter({ hasText: "Zephyrwear opens a London flagship" })
      .getByTestId("mention-source"),
  ).toHaveText("News mentions");
  await expect(
    rows
      .filter({ hasText: "Zephyrwear raises a Series B" })
      .getByTestId("mention-source"),
  ).toHaveText("Hacker News mentions");
  await expect(
    rows
      .filter({ hasText: "Zephyrwear autumn campaign film" })
      .getByTestId("mention-source"),
  ).toHaveText("YouTube mentions");
  await expect(
    page.getByText("Zephyr winds expected this weekend"),
  ).toHaveCount(0);

  await testInfo.attach(`j9-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(
    await consoleFailures(page, watched, testInfo),
    testInfo.project.name,
  ).toEqual([]);
});
