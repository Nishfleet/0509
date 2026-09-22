import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  BRAND_LINES_QUERY,
  parseBriefPayload,
} from "../../workers/delivery/brief-data";
import { renderBrief } from "../../workers/delivery/brief-template";

/**
 * The per-brand query and the render, against the real D1 the deploy ships.
 *
 * A unit test over a restated query cannot prove the OFF rule: the claim
 * "OFF brands are absent, not zeroed" is a claim about the SQL, so the proof has
 * to run the SQL. This applies migrations/0001_rebuild.sql to real local D1,
 * inserts a workspace with one ON and one OFF brand, and reads the brief's own
 * brand-block input back.
 */
let seededRuns = 0;

async function seed(): Promise<{ workspaceId: string; weekStart: string }> {
  seededRuns += 1;
  const now = "2026-09-21T12:00:00.000Z";
  const weekStart = "2026-09-21T12:00:00.000Z";
  const workspaceId = `ws_brief_integration_${String(seededRuns)}`;
  const userId = `u_brief_${String(seededRuns)}`;
  const onEntity = `ent_on_${String(seededRuns)}`;
  const offEntity = `ent_off_${String(seededRuns)}`;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    ).bind(userId, "Test", `brief-${String(seededRuns)}@example.test`, now),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(workspaceId, "Brief Test", userId, "America/New_York", now),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'On Brand', 'on', ?4)",
    ).bind(onEntity, workspaceId, `on-${String(seededRuns)}.example`, now),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Off Brand', 'off', ?4)",
    ).bind(offEntity, workspaceId, `off-${String(seededRuns)}.example`, now),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at) VALUES (?1, ?2, ?3, ?4, 12, 1, 2, ?5)",
    ).bind(`st_on_${String(seededRuns)}`, workspaceId, onEntity, weekStart, now),
    env.DB.prepare(
      "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at) VALUES (?1, ?2, ?3, ?4, 9, 2, 1, ?5)",
    ).bind(`st_off_${String(seededRuns)}`, workspaceId, offEntity, weekStart, now),
  ]);

  return { workspaceId, weekStart, onEntity };
}

describe("the brief's per-brand read, against real D1", () => {
  it("returns the ON brand and never the OFF one", async () => {
    const { workspaceId, weekStart, onEntity } = await seed();
    const rows = await env.DB.prepare(BRAND_LINES_QUERY)
      .bind(workspaceId, weekStart)
      .all<{ entity_id: string; name: string; rank: number }>();

    const ids = (rows.results ?? []).map((r) => r.entity_id);
    expect(ids).toEqual([onEntity]);
  });

  it("renders a brief whose brand block has no row for the off brand", async () => {
    const { workspaceId, weekStart } = await seed();
    const rows = await env.DB.prepare(BRAND_LINES_QUERY)
      .bind(workspaceId, weekStart)
      .all<{ entity_id: string; name: string; rank: number; movement: number | null }>();

    const payload = parseBriefPayload(
      JSON.stringify({
        workspace_id: workspaceId,
        timezone: "America/New_York",
        period_start: "2026-09-14T12:00:00.000Z",
        period_end: weekStart,
        headline_rank: 1,
        headline_total: 1,
        headline_movement: 2,
        headline_is_new: false,
        why_line: "Quiet week: 0 mentions checked, 1 site change, no new ads.",
        read_this_first: [],
        brands: (rows.results ?? []).map((r) => ({
          entity_id: r.entity_id,
          name: r.name,
          rank: r.rank,
          movement: r.movement,
          is_new: false,
          biggest_move: null,
          ad_delta: 0,
          mention_delta: 0,
          site_change_count: 1,
        })),
        own_site: { status: "ok", incidents: [] },
        checked: {
          mention_count: 0,
          site_change_count: 1,
          new_ad_count: 0,
          source_keys: ["meta"],
          degraded_source_keys: [],
        },
        next_brief_at: "2026-09-28T12:00:00.000Z",
      }),
    );

    const { html, text } = renderBrief(payload, {
      unsubscribe_url: "https://0509.io/u/token",
      asset_base_url: "https://assets.0509.io",
    });

    expect(text).toContain("On Brand — #1, up 2");
    expect(html).not.toContain("Off Brand");
    expect(text).not.toContain("Off Brand");
  });
});
