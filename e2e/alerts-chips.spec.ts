import type { DatabaseSync } from "node:sqlite";

import { expect, test, type Page } from "@playwright/test";

import { consoleFailures, isLocalLane, readPreview, run, seedPreviewSession, watchConsole } from "./inbox";

test.skip(
  !isLocalLane(),
  "the three treatments are rows in the local preview database; production signs in through the magic-link inbox and has no fixture workspace",
);

async function seedSession(): Promise<{ cookie: string; workspaceId: string }> {
  const { cookie, seeded } = await seedPreviewSession("alert-chips", seed);
  return { cookie, workspaceId: seeded };
}

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const workspaceId = `ws-${suffix}`;
  const onId = `ent-on-${suffix}`;
  const offId = `ent-off-${suffix}`;
  const sourceId = `src-medium-${suffix}`;
  const adsSourceId = `src-ads-${suffix}`;
  const stamp = "2026-09-25T00:00:00.000Z";
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Alert Chips",
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
  verdict(
    `jev-held-${suffix}`,
    `sig-held-${suffix}`,
    onId,
    0.05,
    "A ticker line, not a move.",
    "2026-09-25T06:00:00.000Z",
  );
  verdict(`jev-off-${suffix}`, `sig-off-${suffix}`, offId, 0.99, "Paused brand reason.", "2026-09-25T06:00:00.000Z");
  run(
    db,
    "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?, ?, 'ads', 'meta', ?, 'best_effort', 1, '{}')",
    adsSourceId,
    `meta.ads-${suffix}`,
    `meta.ads-${suffix}`,
  );
  const ad = (n: number) => {
    const id = `sig-ad-${n}-${suffix}`;
    run(
      db,
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, payload_json, dedup_key, published_at, observed_at)
         VALUES (?, ?, ?, ?, 'ad', ?, ?, ?, ?, '{}', ?, ?, ?)`,
      id,
      workspaceId,
      onId,
      adsSourceId,
      `Zephyrwear ad ${n}`,
      `https://ads.example/${n}`,
      `https://ads.example/${n}`,
      `hash-${id}`,
      `dedup-${id}`,
      null,
      `2026-09-25T0${n}:00:00.000Z`,
    );
    run(
      db,
      `INSERT INTO alert (id, workspace_id, entity_id, signal_id, kind, title, body, created_at)
         VALUES (?, ?, ?, ?, 'ad', ?, NULL, ?)`,
      `alert-ad-${n}-${suffix}`,
      workspaceId,
      onId,
      id,
      `Zephyrwear ran ad ${n}`,
      `2026-09-25T0${n}:00:00.000Z`,
    );
  };
  ad(1);
  ad(2);
  const hiringSourceId = `src-hiring-${suffix}`;
  run(
    db,
    "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?, ?, 'hiring', 'greenhouse', ?, 'official_api', 1, '{}')",
    hiringSourceId,
    `hiring.greenhouse-${suffix}`,
    `hiring.greenhouse-${suffix}`,
  );
  const role = (id: string, entityId: string, title: string) =>
    run(
      db,
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, summary, url, payload_json, dedup_key, published_at, observed_at)
         VALUES (?, ?, ?, ?, 'hiring', ?, 'Berlin · Platform', ?, '{}', ?, NULL, '2026-09-26T08:00:00.000Z')`,
      id,
      workspaceId,
      entityId,
      hiringSourceId,
      title,
      `https://boards.example/${id}`,
      `dedup-${id}`,
    );
  role(`sig-role-${suffix}`, onId, "Senior Backend Engineer");
  role(`sig-role-off-${suffix}`, offId, "Paused brand role should stay hidden");
  return workspaceId;
}

async function measure(page: Page) {
  await page.addStyleTag({ content: "html, body { overflow-x: visible !important; }" });
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

function sqlCounts(workspaceId: string): { ads: number; mentions: number; hiring: number } {
  return readPreview((db) => {
    const ads = db
      .prepare(
        `SELECT count(*) AS n FROM alert a
         JOIN signal s ON s.id = a.signal_id AND s.is_tombstoned = 0
         JOIN entity e ON e.id = a.entity_id AND e.state = 'on'
         WHERE a.workspace_id = ? AND a.kind = 'ad'`,
      )
      .get(workspaceId) as { n: number };
    const mentions = db
      .prepare(
        `SELECT count(*) AS n FROM signal s
         JOIN entity e ON e.id = s.entity_id AND e.state = 'on'
         WHERE s.workspace_id = ? AND s.kind = 'mention'`,
      )
      .get(workspaceId) as { n: number };
    const hiring = db
      .prepare(
        `SELECT count(*) AS n FROM signal s
         JOIN entity e ON e.id = s.entity_id AND e.state = 'on'
         WHERE s.workspace_id = ? AND s.kind = 'hiring'`,
      )
      .get(workspaceId) as { n: number };
    return { ads: ads.n, mentions: mentions.n, hiring: hiring.n };
  });
}

test("alert type chips filter one feed with honest counts", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const watched = watchConsole(page);

  const { cookie, workspaceId } = await seedSession();
  const counts = sqlCounts(workspaceId);
  expect(counts.ads).toBe(2);
  expect(counts.mentions).toBe(4);
  expect(counts.hiring).toBe(1);

  await page.setExtraHTTPHeaders({ cookie });
  const response = await page.goto("/app/alerts");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId("alert-chip-ads")).toContainText(String(counts.ads));
  await expect(page.getByTestId("alert-chip-mentions")).toContainText(String(counts.mentions));
  await expect(page.getByTestId("alert-chip-hiring")).toContainText(String(counts.hiring));
  await expect(page.getByTestId("alert-chip-site-changes")).toBeDisabled();

  await page.getByTestId("alert-chip-ads").click();
  await expect(page).toHaveURL(/[?&]kind=ads/);
  await expect(page.getByText("Zephyrwear ran ad 1")).toBeVisible();
  await expect(page.getByText("Zephyrwear ran ad 2")).toBeVisible();
  await expect(page.getByTestId("mention-row")).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/[?&]kind=ads/);
  await expect(page.getByText("Zephyrwear ran ad 1")).toBeVisible();
  await expect(page.getByText("Zephyrwear ran ad 2")).toBeVisible();
  await expect(page.getByTestId("alert-chip-ads")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("alert-chip-mentions").click();
  await expect(page).toHaveURL(/[?&]kind=mentions/);
  await expect(page.getByText("Zephyrwear ran ad 1")).toHaveCount(0);
  await expect(page.getByText("Zephyrwear ran ad 2")).toHaveCount(0);

  await page.getByTestId("alert-chip-hiring").click();
  await expect(page).toHaveURL(/[?&]kind=hiring/);
  const role = page.getByTestId("hiring-row");
  await expect(role).toHaveCount(1);
  await expect(role).toContainText("Senior Backend Engineer");
  await expect(role).toContainText("Zephyrwear is hiring · Berlin · Platform");
  await expect(role.getByRole("link", { name: "Senior Backend Engineer" })).toHaveAttribute(
    "rel",
    "noopener noreferrer nofollow",
  );
  await expect(page.getByText("Paused brand role should stay hidden")).toHaveCount(0);

  await page.getByTestId("alert-chip-all").click();
  await expect(page).not.toHaveURL(/kind=/);

  if (testInfo.project.name === "phone-390") {
    const widths = await measure(page);
    expect(widths.scrollWidth, JSON.stringify(widths)).toBe(widths.clientWidth);
  }

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
