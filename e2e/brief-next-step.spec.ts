import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { seedWorkspace, signIn } from "./quality";

test.skip(!isLocalLane(), "the preview Worker signs in through a seeded session; production has no fixture workspace");

function mark(suffix: string, id: string, name: string, kind: string | null, reason: string) {
  return {
    signal_id: `sig-${id}-${suffix}`,
    entity_id: `ent-${id}-${suffix}`,
    entity_name: name,
    title: `${name} changed something`,
    source: "site",
    observed_at: "2026-10-10T09:00:00.000Z",
    thumbnail_r2_key: null,
    url: null,
    before: null,
    after: null,
    jev_reason: reason,
    kind,
  };
}

function seedBrief({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const workspaceId = seedWorkspace(db, suffix, userId);
  const digestId = `dg-${suffix}`;
  const payload = JSON.stringify({
    workspace_id: workspaceId,
    timezone: "UTC",
    period_start: "2026-10-05T08:00:00.000Z",
    period_end: "2026-10-12T08:00:00.000Z",
    headline_rank: 1,
    headline_total: 3,
    headline_movement: 0,
    headline_is_new: false,
    why_line: "Three rivals moved this week.",
    is_quiet_week: false,
    is_unjudged: false,
    read_this_first: [
      mark(suffix, "p", "Pricefall", "pricing", "Cut its Pro plan price."),
      mark(suffix, "o", "Offerly", "offer", "Started a free month."),
      mark(suffix, "u", "Mystery Co", null, "Changed its footer."),
    ],
    brands: [],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 0,
      site_change_count: 3,
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
}

test("each item under Read this first ends with the next step for its kind, and an unknown kind gets none", async ({
  page,
  baseURL,
}) => {
  const { cookie, seeded } = await seedPreviewSession("brief-next", seedBrief);
  await signIn(page, baseURL, cookie);
  await page.goto(`/app/brief/${seeded}`);

  const block = page.locator("[data-brief-block=read-this-first]");
  await expect(block.getByRole("heading", { name: "Read this first" })).toBeVisible();
  await expect(block.getByText(/Pricefall: Cut its Pro plan price\./)).toBeVisible();
  await expect(block.getByText("Compare it with your own pricing.")).toBeVisible();
  await expect(block.getByText(/Offerly: Started a free month\./)).toBeVisible();
  await expect(block.getByText("Decide whether your customers will notice it and whether to answer.")).toBeVisible();
  await expect(block.getByText(/Mystery Co: Changed its footer\./)).toBeVisible();
  await expect(block.locator("p.text-ink-soft")).toHaveCount(5);
});
