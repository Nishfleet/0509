import type { DatabaseSync } from "node:sqlite";

import { expect, test, type Page } from "@playwright/test";

import { consoleFailures, isLocalLane, watchConsole } from "./inbox";
import { run, seedPreviewSession } from "./preview-session";

function rankedRow(page: Page, name: string) {
  return page.locator('[data-testid="standing-row"]', { hasText: name });
}

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database; production reads a real ranked /app",
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
  const selfId = `ent_self-${suffix}`;
  const kindredId = `ent_kindred-${suffix}`;
  const casettaId = `ent_casetta-${suffix}`;
  const stamp = "2026-09-25T00:00:00.000Z";

  // workspace + owner user
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'Europe/London', 1, 8, ?)",
    workspaceId,
    "Ranked Home",
    userId,
    stamp,
  );

  // entities: self (Loopwell) + 2 competitors (Kindred, Casetta) — all ON
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'self', ?, 'Loopwell', 'on', ?)",
    selfId,
    workspaceId,
    "loopwell.example",
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, 'Kindred', 'on', ?)",
    kindredId,
    workspaceId,
    "kindred.example",
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, 'Casetta', 'on', ?)",
    casettaId,
    workspaceId,
    "casetta.example",
    stamp,
  );

  // enabled sources used by the viewer (src_site_web, src_mentions_gdelt)
  // These rows exist in the local D1 from migrations; we only ensure they are enabled.
  // The local preview D1 starts with migrations applied, so these ids exist.

  // weekly digest payload (ranked: Kindred 1, Loopwell 2, Casetta 3)
  const periodStart = "2026-09-14T07:00:00.000Z";
  const periodEnd = "2026-09-21T07:00:00.000Z";
  const payload = {
    workspace_id: workspaceId,
    timezone: "Europe/London",
    period_start: periodStart,
    period_end: periodEnd,
    headline_rank: 2,
    headline_total: 3,
    headline_movement: 1,
    headline_is_new: false,
    why_line: "Kindred is the mover: 3 new ads",
    is_quiet_week: false,
    is_unjudged: false,
    read_this_first: [],
    brands: [
      {
        entity_id: kindredId,
        name: "Kindred",
        rank: 1,
        movement: 1,
        is_new: false,
        biggest_move: "Kindred launched 3 new ads",
        ad_delta: 3,
        mention_delta: 1,
        site_change_count: 2,
        new_roles: 0,
      },
      {
        entity_id: selfId,
        name: "Loopwell",
        rank: 2,
        movement: 0,
        is_new: false,
        biggest_move: null,
        ad_delta: 0,
        mention_delta: 0,
        site_change_count: 0,
        new_roles: 0,
      },
      {
        entity_id: casettaId,
        name: "Casetta",
        rank: 3,
        movement: null,
        is_new: true,
        biggest_move: null,
        ad_delta: 0,
        mention_delta: 0,
        site_change_count: 0,
        new_roles: 0,
      },
    ],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 1,
      site_change_count: 2,
      new_ad_count: 3,
      source_keys: ["site.web", "gdelt.doc"],
      degraded_source_keys: ["hn.algolia"],
      degraded_sources: [{ key: "hn.algolia", name: "Hacker News", last_landed_at: null }],
    },
    next_brief_at: null,
  };
  run(
    db,
    "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json) VALUES (?, ?, 'weekly', ?, ?, 'sent', ?)",
    `${workspaceId}_digest`,
    workspaceId,
    periodStart,
    periodEnd,
    JSON.stringify(payload),
  );

  // 4 weeks of standing history for the four-week chart (matching old fixture: Loopwell 3,3,2,2; Kindred 2,1,1,1; Casetta 1,2,3,3)
  // Weeks oldest → newest: 2026-08-24, 2026-08-31, 2026-09-07, 2026-09-14
  const weeks = [
    "2026-08-24T07:00:00.000Z",
    "2026-08-31T07:00:00.000Z",
    "2026-09-07T07:00:00.000Z",
    "2026-09-14T07:00:00.000Z",
  ];
  // Loopwell ranks: 3, 3, 2, 2
  // Kindred ranks: 2, 1, 1, 1
  // Casetta ranks: 1, 2, 3, 3
  const selfRanks = [3, 3, 2, 2];
  const kindredRanks = [2, 1, 1, 1];
  const casettaRanks = [1, 2, 3, 3];

  const standingValues: string[] = [];
  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    standingValues.push(
      `('${workspaceId}_stand_self_${i}', '${workspaceId}', '${selfId}', '${week}', 0, ${selfRanks[i]}, '${week}')`,
      `('${workspaceId}_stand_kindred_${i}', '${workspaceId}', '${kindredId}', '${week}', 0, ${kindredRanks[i]}, '${week}')`,
      `('${workspaceId}_stand_casetta_${i}', '${workspaceId}', '${casettaId}', '${week}', 0, ${casettaRanks[i]}, '${week}')`,
    );
  }
  run(db, `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, computed_at) VALUES ${standingValues.join(", ")}`);

  // signal rows for Kindred's evidence (opened row) — site_change (2) and mention (1)
  const periodStartDate = new Date(periodStart).toISOString();
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at, is_tombstoned, title, summary, url, evidence_url, payload_json)
     VALUES (?, ?, ?, 'src_site_web', 'change', ?, ?, 0, ?, ?, ?, ?, '{}')`,
    `sig_ev_1-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_ev_1-${suffix}`,
    periodStartDate,
    "Pricing page rewrote its hero",
    null,
    "https://kindred.example/pricing",
    "https://shots.example/ev-1.png",
  );
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at, is_tombstoned, title, summary, url, evidence_url, payload_json)
     VALUES (?, ?, ?, 'src_site_web', 'change', ?, ?, 0, ?, ?, ?, ?, '{}')`,
    `sig_ev_2-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_ev_2-${suffix}`,
    "2026-09-19T09:00:00.000Z",
    null,
    "Docs link added to the nav",
    null,
    null,
    "{}",
  );
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at, is_tombstoned, title, summary, url, evidence_url, payload_json)
     VALUES (?, ?, ?, 'src_mentions_gdelt', 'mention', ?, ?, 0, ?, ?, ?, ?, '{}')`,
    `sig_ev_3-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_ev_3-${suffix}`,
    "2026-09-18T08:00:00.000Z",
    "Kindred mentioned on r/sysadmin",
    null,
    "https://www.reddit.com/r/sysadmin/comments/abc",
    null,
    "{}",
  );

  // signal rows for this week's counts (pills) — Kindred: site_change 2, mention 1; Casetta: 0
  // These are separate from evidence rows; they are counted by readHomeStandingInputs's SELECT_HOME_COUNTS
  // which filters observed_at >= period_start from the newest digest.
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at, is_tombstoned)
     VALUES (?, ?, ?, 'src_site_web', 'change', ?, ?, 0)`,
    `sig_count_1-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_count_1-${suffix}`,
    "2026-09-16T10:00:00.000Z",
  );
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at, is_tombstoned)
     VALUES (?, ?, ?, 'src_site_web', 'change', ?, ?, 0)`,
    `sig_count_2-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_count_2-${suffix}`,
    "2026-09-17T10:00:00.000Z",
  );
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, dedup_key, observed_at, is_tombstoned)
     VALUES (?, ?, ?, 'src_mentions_gdelt', 'mention', ?, ?, 0)`,
    `sig_count_3-${suffix}`,
    workspaceId,
    kindredId,
    `dedup_count_3-${suffix}`,
    "2026-09-15T10:00:00.000Z",
  );
}

async function seedSession(): Promise<string> {
  return seedPreviewSession("ranked-row", seed);
}

test("a ranked row expands in place and the open param survives a reload @smoke", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "in-place expansion is the desktop layout");
  const watched = watchConsole(page);

  const cookie = await seedSession();
  await page.setExtraHTTPHeaders({ cookie });

  const response = await page.goto("/app");
  expect(response?.status()).toBe(200);
  await page.evaluate(() => {
    (window as unknown as { __stay: number }).__stay = 1;
  });

  await rankedRow(page, "Kindred").locator('[data-slot="row-toggle"]').click();
  await expect(page).toHaveURL(/[?&]open=ent_kindred/);

  const row = rankedRow(page, "Kindred");
  await expect(row).toHaveAttribute("data-open", "true");
  const evidence = row.locator('[data-slot="row-evidence"]');
  await expect(evidence).toBeVisible();
  await expect(evidence.getByRole("tab", { name: "Site changes 2" })).toBeVisible();
  await expect(evidence.getByRole("tab", { name: "Mentions 1" })).toBeVisible();
  await expect(evidence.getByRole("tab", { name: "Ads 0" })).toBeVisible();
  await expect(evidence.getByRole("tab", { name: "Hiring 0" })).toBeVisible();

  const stayed = await page.evaluate(() => (window as unknown as { __stay: number }).__stay);
  expect(stayed).toBe(1);

  await page.reload();
  await expect(page.locator('[data-slot="row-evidence"]')).toBeVisible();

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("below 860px an open ranked row's evidence is a bottom sheet that clears the param @smoke", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390", "the sheet is the phone layout");
  const watched = watchConsole(page);

  const cookie = await seedSession();
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app");
  await rankedRow(page, "Kindred").locator('[data-slot="row-toggle"]').click();
  await expect(page).toHaveURL(/[?&]open=ent_kindred/);

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator('[data-slot="row-evidence"]')).toBeHidden();

  await page.addStyleTag({ content: "html, body { overflow-x: visible !important; }" });
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(m.scrollWidth, JSON.stringify(m)).toBe(m.clientWidth);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]open=/);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("a zero-signal row shows a dash and the self row's switch reads you @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  const cookie = await seedSession();
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app");
  await expect(rankedRow(page, "Casetta")).toContainText("—");
  await expect(
    page.locator('[data-testid="standing-row"][data-self="true"] [data-slot="brand-switch"]'),
  ).toHaveAttribute("data-state", "you");

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});