import type { DatabaseSync } from "node:sqlite";

import { type Page } from "@playwright/test";

import { isLocalLane, run, seedPreviewSession, writePreview } from "./inbox";
import { SCHEMES, scanPage, seedCompetitor, seedWorkspace, signIn, startQuality } from "./quality";
import { expect, test } from "./test";

test.skip(!isLocalLane(), "seeds one customer's week in the local preview database; never run against production");

test.setTimeout(240_000);

function seedFirstBrief(db: DatabaseSync, workspaceId: string, suffix: string): void {
  const payload = JSON.stringify({
    workspace_id: workspaceId,
    timezone: "UTC",
    period_start: "2026-10-05T08:00:00.000Z",
    period_end: "2026-10-12T08:00:00.000Z",
    headline_rank: 2,
    headline_total: 3,
    headline_movement: 0,
    headline_is_new: true,
    why_line: "Zephyrwear led the first week and you are one place behind.",
    is_quiet_week: false,
    is_unjudged: false,
    read_this_first: [],
    brands: [
      {
        entity_id: `ent-z-${suffix}`,
        name: "Zephyrwear",
        rank: 1,
        movement: 0,
        is_new: true,
        biggest_move: "Opened a London flagship",
      },
    ],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 3,
      site_change_count: 0,
      new_ad_count: 0,
      source_keys: [],
      degraded_source_keys: [],
      degraded_sources: [],
    },
    next_brief_at: null,
  });
  run(
    db,
    "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at) VALUES (?, ?, 'weekly', '2026-10-05T08:00:00.000Z', '2026-10-12T08:00:00.000Z', 'sent', ?, ?, '2026-10-12T08:01:00.000Z')",
    `dg-${suffix}`,
    workspaceId,
    "Your first ranking: you're #2 of 3",
    payload,
  );
}

function seedMention(db: DatabaseSync, workspaceId: string, suffix: string): void {
  run(
    db,
    "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?, ?, 'mentions', 'medium', ?, 'rss', 1, '{}')",
    `src-fw-${suffix}`,
    `medium.fw-${suffix}`,
    `medium.fw-${suffix}`,
  );
  run(
    db,
    "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, payload_json, dedup_key, published_at, observed_at) VALUES (?, ?, ?, ?, 'mention', 'Zephyrwear opens a London flagship', 'https://news.example/flagship', 'https://news.example/flagship', ?, '{}', ?, '2026-10-08T08:00:00.000Z', '2026-10-09T09:00:00.000Z')",
    `sig-fw-${suffix}`,
    workspaceId,
    `ent-z-${suffix}`,
    `src-fw-${suffix}`,
    `hash-fw-${suffix}`,
    `dedup-fw-${suffix}`,
  );
  run(
    db,
    "INSERT INTO jev_verdict (id, workspace_id, question_id, input_hash, signal_id, entity_id, p, reason, decided_at) VALUES (?, ?, 'mention_matters', ?, ?, ?, 0.95, 'A London flagship is a move worth knowing.', '2026-10-09T09:30:00.000Z')",
    `jev-fw-${suffix}`,
    workspaceId,
    `hash-jev-fw-${suffix}`,
    `sig-fw-${suffix}`,
    `ent-z-${suffix}`,
  );
}

async function openPlace(page: Page, place: "Home" | "Competitors" | "Alerts" | "Settings"): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: place, exact: true }).click();
  await expect(nav.getByRole("link", { name: place, exact: true })).toHaveAttribute("aria-current", "page");
}

async function expectNoSideways(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

test("one customer's first week: gathering, a second rival, a first alert, the first ranking, a teammate, a pause and a resume", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  const { cookie, seeded } = await seedPreviewSession("first-week", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId, "First Week");
    seedCompetitor(db, suffix, workspaceId);
    return { workspaceId, suffix };
  });
  await signIn(page, baseURL, cookie);

  await page.goto("/app");
  const firstLook = page.locator('[data-home="first-look"]');
  await expect(firstLook.getByRole("heading", { name: "Where your competitors stand today" })).toBeVisible();
  await expect(firstLook).toContainText("Zephyrwear");
  await expect(page.locator('[data-home="first-week-steps"]')).toBeVisible();
  await expectNoSideways(page);
  await scanPage(page, testInfo, quality, `week day 0 Home ${testInfo.project.name}`, {
    screen: /^good (morning|afternoon|evening)/i,
    keyboard: true,
  });

  await openPlace(page, "Competitors");
  const count = page.locator('[data-slot="competitor-count"]');
  await expect(count).toContainText("Watching 1 of 5 competitors on your plan.");
  await page.getByLabel("Add a competitor we missed").fill("example.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added. We're reading their site now." })).toBeVisible();
  await expect(count).toContainText("Watching 2 of 5 competitors on your plan.");
  await expect(count.getByRole("link", { name: "See plans" })).toHaveCount(0);

  await openPlace(page, "Alerts");
  await expect(page.getByTestId("mention-row")).toHaveCount(0);
  writePreview((db) => {
    seedMention(db, seeded.workspaceId, seeded.suffix);
  });
  await openPlace(page, "Home");
  await openPlace(page, "Alerts");
  await expect(page.getByText("Zephyrwear opens a London flagship")).toBeVisible();
  await expect(page.getByTestId("alert-chip-mentions")).toContainText("1");
  await scanPage(page, testInfo, quality, `week day 4 Alerts ${testInfo.project.name}`, {
    screen: /^alerts$/i,
    keyboard: false,
  });

  await page.goto("/app/brief");
  await expect(page.getByText(/first brief/i)).toBeVisible();
  writePreview((db) => {
    seedFirstBrief(db, seeded.workspaceId, seeded.suffix);
  });
  await openPlace(page, "Home");
  await page.goto("/app/brief");
  await expect(page.locator("[data-brief-state=sent]")).toHaveText(/Week of 5 Oct · Sent 12 Oct/);
  await expect(page.getByText("Zephyrwear led the first week and you are one place behind.")).toBeVisible();
  await expectNoSideways(page);
  await scanPage(page, testInfo, quality, `week day 7 Brief ${testInfo.project.name}`, {
    screen: /^your weekly brief$/i,
    keyboard: false,
  });

  await openPlace(page, "Settings");
  const teammate = `mate-${Date.now().toString(36)}-${testInfo.project.name}@example.com`;
  await page.getByLabel("Teammate's email").fill(teammate);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: teammate })).toContainText("waiting for them to confirm");

  await page.getByRole("button", { name: "Pause the brief" }).click();
  await expect(page.getByText(/Paused since/)).toBeVisible();
  await page.goto("/app");
  await expect(page.getByText(/Your weekly brief has been paused since/)).toBeVisible();
  await page.getByRole("link", { name: "Resume it in Settings" }).click();
  await page.getByRole("button", { name: "Resume the brief" }).click();
  await expect(page.getByRole("button", { name: "Pause the brief" })).toBeVisible();
  await page.goto("/app");
  await expect(page.getByText(/Your weekly brief has been paused since/)).toHaveCount(0);
  await expect(page.getByText("Zephyrwear").first()).toBeVisible();
});

const SCREENS = [
  { path: "/app", says: "Add a competitor to see where you stand." },
  { path: "/app/competitors", says: "Add a competitor to see where you stand. We also look for new ones every week." },
  { path: "/app/brief", says: "Your weekly brief" },
  { path: "/app/alerts", says: "Nothing yet. When a competitor changes its website, gets a mention or posts a job" },
  { path: "/app/settings", says: "Also send the brief to" },
] as const;

test("a brand-new workspace with no competitors explains every screen and passes the quality checks", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  const { cookie } = await seedPreviewSession("quality-empty", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    run(
      db,
      "INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at, watching_started_at) SELECT ?, ?, owner_user_id, 'self.example', ?, ? FROM workspace WHERE id = ?",
      `run-${suffix}`,
      workspaceId,
      "2026-09-25T00:00:00.000Z",
      "2026-09-25T00:00:00.000Z",
      workspaceId,
    );
  });
  await signIn(page, baseURL, cookie);

  for (const screen of SCREENS) {
    const response = await page.goto(screen.path);
    expect(response?.status(), screen.path).toBe(200);
    await expect(page.getByRole("main"), screen.path).toContainText(screen.says);
    await expect(page.getByRole("main"), screen.path).not.toContainText(/\b(?:undefined|null|NaN)\b|\{\{/);
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(width.scroll, `${screen.path}: no sideways scroll`).toBeLessThanOrEqual(width.inner);
    for (const colorScheme of SCHEMES) {
      await page.emulateMedia({ colorScheme });
      await scanPage(page, testInfo, quality, `${screen.path} empty ${colorScheme} ${testInfo.project.name}`, {
        screen: /\S/,
        keyboard: false,
      });
    }
  }
});
