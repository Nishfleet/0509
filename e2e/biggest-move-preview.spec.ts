import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session with scored rows; production reads a live competitor in biggest-move.spec.ts",
);

const MENTION_TITLE = "Zephyrwear named in a roundup of the year's best launches";

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const stamp = "2026-10-12T00:00:00.000Z";
  const workspaceId = `ws-${suffix}`;
  const entityId = `ent-z-${suffix}`;
  const sourceId = `src-bm-${suffix}`;
  const now = Date.now();
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Biggest Move Preview",
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
    entityId,
    workspaceId,
    `zephyr-${suffix}.example`,
    stamp,
  );
  run(
    db,
    "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?, ?, 'mentions', 'medium', ?, 'rss', 1, '{}')",
    sourceId,
    `bm.feed-${suffix}`,
    `bm.feed-${suffix}`,
  );
  const signals = [
    { id: `sig-mention-${suffix}`, kind: "mention", title: MENTION_TITLE, hoursAgo: 3 },
    { id: `sig-hiring-${suffix}`, kind: "hiring", title: "Senior engineer role", hoursAgo: 2 },
  ];
  signals.forEach((item) => {
    const url = `https://${item.kind}.example/${suffix}`;
    run(
      db,
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, payload_json, dedup_key, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
      item.id,
      workspaceId,
      entityId,
      sourceId,
      item.kind,
      item.title,
      url,
      url,
      `hash-${item.id}`,
      `dedup-${item.id}`,
      new Date(now - item.hoursAgo * 3_600_000).toISOString(),
    );
  });
  run(
    db,
    `INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, reason, decided_at)
     VALUES (?, ?, 'mention_matters', ?, ?, ?, 0.95, 'A trade roundup names the brand.', ?)`,
    `verdict-${suffix}`,
    workspaceId,
    `hash-verdict-${suffix}`,
    `sig-mention-${suffix}`,
    entityId,
    new Date(now - 3_600_000).toISOString(),
  );
  return entityId;
}

test("a competitor with a scored mention and a new role names the mention as its biggest move", async ({
  page,
  baseURL,
}, testInfo) => {
  const watched = watchConsole(page);
  const { cookie, seeded } = await seedPreviewSession("biggest-move", seed);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );

  await page.goto(`/app/competitors/${seeded}`);
  const slab = page.locator("[data-section='biggest-move']");
  await expect(slab).toBeVisible();
  const move = slab.getByTestId("biggest-move");
  await expect(move.getByRole("heading", { name: MENTION_TITLE })).toBeVisible();
  await expect(move).toContainText("Mention · medium");
  await expect(slab.locator("[data-slot='biggest-move-read']")).toHaveText(
    "Mentions that matter: 3 × 0.9 = 2.7 points, the most of anything this brand did this week.",
  );
  await expect(move.getByRole("link", { name: /Open the source/ })).toHaveAttribute(
    "href",
    new RegExp(`^https://mention\\.example/`),
  );
  await expect(slab.getByText(/Nothing worth scoring/)).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
