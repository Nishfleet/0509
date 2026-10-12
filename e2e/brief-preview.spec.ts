import type { DatabaseSync } from "node:sqlite";

import { expect, test, type Page } from "@playwright/test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";

test.skip(!isLocalLane(), "the preview Worker signs in through a seeded session; production has no fixture workspace");

function seedWorkspace(db: DatabaseSync, suffix: string, userId: string): string {
  const stamp = "2026-10-12T00:00:00.000Z";
  const workspaceId = `ws-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Brief Preview",
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
  return workspaceId;
}

async function signIn(page: Page, baseURL: string | undefined, cookie: string): Promise<void> {
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );
}

test("a workspace with no brief yet says when the first one comes", async ({ page, baseURL }) => {
  const { cookie } = await seedPreviewSession("brief-empty", ({ db, suffix, userId }) => {
    seedWorkspace(db, suffix, userId);
  });
  await signIn(page, baseURL, cookie);
  const response = await page.goto("/app/brief");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/first brief/i)).toBeVisible();
});

test("a sent brief opens by its week, and an id that is not there is a 404", async ({ page, baseURL }) => {
  const { cookie, seeded } = await seedPreviewSession("brief-sent", ({ db, suffix, userId }) => {
    const workspaceId = seedWorkspace(db, suffix, userId);
    const digestId = `dg-${suffix}`;
    const payload = JSON.stringify({
      workspace_id: workspaceId,
      timezone: "UTC",
      period_start: "2026-10-05T08:00:00.000Z",
      period_end: "2026-10-12T08:00:00.000Z",
      headline_rank: 2,
      headline_total: 3,
      headline_movement: 1,
      headline_is_new: false,
      why_line: "Zephyrwear cut its price and you moved up one place.",
      is_quiet_week: false,
      is_unjudged: false,
      read_this_first: [],
      brands: [
        {
          entity_id: `ent-z-${suffix}`,
          name: "Zephyrwear",
          rank: 1,
          movement: 1,
          is_new: false,
          biggest_move: "Cut its Pro plan price",
        },
      ],
      own_site: { status: "ok", incidents: [] },
      checked: {
        mention_count: 4,
        site_change_count: 1,
        new_ad_count: 0,
        source_keys: [],
        degraded_source_keys: [],
        degraded_sources: [],
      },
      next_brief_at: null,
    });
    run(
      db,
      "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, subject, payload_json, sent_at) VALUES (?, ?, 'weekly', '2026-10-05T08:00:00.000Z', '2026-10-12T08:00:00.000Z', 'sent', 'Your week', ?, '2026-10-12T08:01:00.000Z')",
      digestId,
      workspaceId,
      payload,
    );
    return digestId;
  });
  await signIn(page, baseURL, cookie);
  const opened = await page.goto(`/app/brief/${seeded}`);
  expect(opened?.status()).toBe(200);
  await expect(page.locator("[data-brief-state=sent]")).toHaveText(/Week of 5 Oct · Sent 12 Oct/);
  await expect(page.getByText("Zephyrwear cut its price and you moved up one place.")).toBeVisible();
  await expect(page.getByText("Zephyrwear").first()).toBeVisible();
  const missing = await page.goto("/app/brief/dg-not-here");
  expect(missing?.status()).toBe(404);
});
