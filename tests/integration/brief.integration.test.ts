import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { BRAND_LINES_QUERY, parseBriefPayload } from "../../app/lib/brief-payload";
import { renderBrief } from "../../workers/delivery/brief-template";
import { composeBrief } from "../../workers/standing/compose-brief";
import { refreshWorkspaceScores } from "../../workers/standing/refresh";

let seededRuns = 0;

async function seed(): Promise<{ workspaceId: string; weekStart: string; onEntity: string }> {
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
        why_line: "Quiet week: 0 mentions, 1 site change, no new ads.",
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
          new_roles: 0,
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

function brandLine(text: string, name: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${name} —`));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((l) => /^\S.* — #\d| — unranked/.test(l));
  return [lines[start], ...(next === -1 ? rest : rest.slice(0, next))].join("\n");
}

let hiringRuns = 0;

async function seedHiring(): Promise<{ workspaceId: string; hiredEntity: string }> {
  hiringRuns += 1;
  const run = String(hiringRuns);
  const now = "2026-09-21T12:00:00.000Z";
  const weekStart = "2026-09-14T12:00:00.000Z";
  const workspaceId = `ws_brief_hiring_${run}`;
  const userId = `u_hiring_${run}`;
  const hiredEntity = `ent_hiring_${run}`;
  const idleEntity = `ent_idle_${run}`;
  const hiringSourceId = `src_hiring_${run}`;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    ).bind(userId, "Test", `hiring-${run}@example.test`, now),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(workspaceId, "Hiring Test", userId, "UTC", now),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'hiring', ?3, ?4, 'official_api')",
    ).bind(hiringSourceId, `hiring-src-${run}`, `hiring-pl-${run}`, `hiring-plugin-${run}`),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Hiring Brand', 'on', ?4)",
    ).bind(hiredEntity, workspaceId, `hiring-${run}.example`, now),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Quiet Brand', 'on', ?4)",
    ).bind(idleEntity, workspaceId, `idle-${run}.example`, now),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at) VALUES (?1, ?2, ?3, ?4, 12, 1, 2, ?5)",
    ).bind(`st_hiring_${run}`, workspaceId, hiredEntity, weekStart, now),
    env.DB.prepare(
      "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at) VALUES (?1, ?2, ?3, ?4, 9, 2, 1, ?5)",
    ).bind(`st_idle_${run}`, workspaceId, idleEntity, weekStart, now),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6, ?7)",
    ).bind(
      `sig_hiring_a_${run}`,
      workspaceId,
      hiredEntity,
      hiringSourceId,
      "Senior Accountant",
      `hiring-a-${run}`,
      "2026-09-15T10:00:00.000Z",
    ),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6, ?7)",
    ).bind(
      `sig_hiring_b_${run}`,
      workspaceId,
      hiredEntity,
      hiringSourceId,
      "Growth Lead",
      `hiring-b-${run}`,
      "2026-09-18T10:00:00.000Z",
    ),
    env.DB.prepare(
      "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'hiring', ?5, ?6, ?7)",
    ).bind(
      `sig_hiring_old_${run}`,
      workspaceId,
      hiredEntity,
      hiringSourceId,
      "Filled last month",
      `hiring-old-${run}`,
      "2026-09-01T10:00:00.000Z",
    ),
  ]);

  return { workspaceId, hiredEntity };
}

describe("new job posts reach the brief's brand line, through real D1", () => {
  it("counts only the week's hiring signals on that brand", async () => {
    const { workspaceId } = await seedHiring();
    const payload = await composeBrief(env.DB, {
      workspaceId,
      schedule: { timezone: "UTC", weekday: 1, hour: 8 },
      week: { startsAt: new Date("2026-09-14T12:00:00.000Z"), closesAt: new Date("2026-09-21T12:00:00.000Z") },
      readThisFirst: { picks: [], judged: 0, unjudged: false },
    });

    const hiring = payload.brands.find((b) => b.entity_id.startsWith("ent_hiring_"));
    expect(hiring?.new_roles).toBe(2);
  });

  it("shows 2 new job posts on that brand's line in the brief", async () => {
    const { workspaceId } = await seedHiring();
    const payload = await composeBrief(env.DB, {
      workspaceId,
      schedule: { timezone: "UTC", weekday: 1, hour: 8 },
      week: { startsAt: new Date("2026-09-14T12:00:00.000Z"), closesAt: new Date("2026-09-21T12:00:00.000Z") },
      readThisFirst: { picks: [], judged: 0, unjudged: false },
    });

    const { text } = renderBrief(parseBriefPayload(JSON.stringify(payload)), {
      unsubscribe_url: "https://0509.io/u/token",
      asset_base_url: "https://assets.0509.io",
    });

    const line = brandLine(text, "Hiring Brand");
    expect(line).toContain("2 new job posts");
  });

  it("omits the phrase on a brand with no hiring, even when other counts are zero", async () => {
    const { workspaceId } = await seedHiring();
    const payload = await composeBrief(env.DB, {
      workspaceId,
      schedule: { timezone: "UTC", weekday: 1, hour: 8 },
      week: { startsAt: new Date("2026-09-14T12:00:00.000Z"), closesAt: new Date("2026-09-21T12:00:00.000Z") },
      readThisFirst: { picks: [], judged: 0, unjudged: false },
    });

    const { text } = renderBrief(parseBriefPayload(JSON.stringify(payload)), {
      unsubscribe_url: "https://0509.io/u/token",
      asset_base_url: "https://assets.0509.io",
    });

    const line = brandLine(text, "Quiet Brand");
    expect(line).toContain("no new ads · no mentions · no site changes");
    expect(line).not.toContain("job post");
  });

  it("leaves the standing score alone — the two roles still score through the existing weight", async () => {
    const { workspaceId, hiredEntity } = await seedHiring();

    const scores = await refreshWorkspaceScores(env.DB, {
      workspaceId,
      weekStartAt: "2026-09-14T12:00:00.000Z",
      windowStartAt: "2026-09-15T00:00:00.000Z",
      windowEndAt: "2026-09-22T00:00:00.000Z",
      computedAt: "2026-09-21T12:00:00.000Z",
    });
    expect(scores.get(hiredEntity)).toBeCloseTo(2, 10);
  });
});

let canaryRuns = 0;

async function seedCanary(canaryCount: number | null): Promise<{ workspaceId: string; sourceKey: string }> {
  canaryRuns += 1;
  const run = String(canaryRuns);
  const now = "2026-09-21T12:00:00.000Z";
  const weekStart = "2026-09-14T12:00:00.000Z";
  const workspaceId = `ws_brief_canary_${run}`;
  const userId = `u_canary_${run}`;
  const entityId = `ent_canary_${run}`;
  const sourceId = `src_canary_${run}`;
  const sourceKey = `canary-mentions-${run}`;
  const watchId = `watch_canary_${run}`;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    ).bind(userId, "Test", `canary-${run}@example.test`, now),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(workspaceId, "Canary Test", userId, "UTC", now),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, 'Canary Brand', 'on', ?4)",
    ).bind(entityId, workspaceId, `canary-${run}.example`, now),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, canary_query) VALUES (?1, ?2, 'mentions', ?3, ?4, 'best_effort', 1, 'test-canary')",
    ).bind(sourceId, sourceKey, `canary-pl-${run}`, `canary-plugin-${run}`),
    env.DB.prepare(
      "INSERT INTO watch (id, entity_id, source_id, target_key, is_active) VALUES (?1, ?2, ?3, ?4, 1)",
    ).bind(watchId, entityId, sourceId, `canary-target-${run}`),
    env.DB.prepare(
      "INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at) VALUES (?1, ?2, ?3, ?4, 12, 1, 2, ?5)",
    ).bind(`st_canary_${run}`, workspaceId, entityId, weekStart, now),
  ]);

  await env.DB.prepare(
    "INSERT INTO snapshot (id, watch_id, fetched_at, payload_hash, item_count, canary_count) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
  )
    .bind(`snap_canary_${run}`, watchId, "2026-09-18T10:00:00.000Z", `hash-${run}`, canaryCount)
    .run();

  return { workspaceId, sourceKey };
}

describe("a zero canary never counts as a source answering, through real D1", () => {
  it("marks the source degraded on canary_count=0 and not degraded on canary_count=2", async () => {
    const zero = await seedCanary(0);
    const zeroPayload = await composeBrief(env.DB, {
      workspaceId: zero.workspaceId,
      schedule: { timezone: "UTC", weekday: 1, hour: 8 },
      week: { startsAt: new Date("2026-09-14T12:00:00.000Z"), closesAt: new Date("2026-09-21T12:00:00.000Z") },
      readThisFirst: { picks: [], judged: 0, unjudged: false },
    });
    expect(zeroPayload.checked.degraded_source_keys).toContain(zero.sourceKey);

    const healthy = await seedCanary(2);
    const healthyPayload = await composeBrief(env.DB, {
      workspaceId: healthy.workspaceId,
      schedule: { timezone: "UTC", weekday: 1, hour: 8 },
      week: { startsAt: new Date("2026-09-14T12:00:00.000Z"), closesAt: new Date("2026-09-21T12:00:00.000Z") },
      readThisFirst: { picks: [], judged: 0, unjudged: false },
    });
    expect(healthyPayload.checked.degraded_source_keys).toEqual([]);
  });
});

describe("each brand's biggest move reaches its brief line, through real D1", () => {
  const compose = (workspaceId: string) =>
    composeBrief(env.DB, {
      workspaceId,
      schedule: { timezone: "UTC", weekday: 1, hour: 8 },
      week: { startsAt: new Date("2026-09-14T12:00:00.000Z"), closesAt: new Date("2026-09-21T12:00:00.000Z") },
      readThisFirst: { picks: [], judged: 0, unjudged: false },
    });

  it("names the week's highest-weighted signal on the brand that has one, and nothing on a quiet brand", async () => {
    const { workspaceId } = await seedHiring();
    const payload = await compose(workspaceId);

    expect(payload.brands.find((b) => b.entity_id.startsWith("ent_hiring_"))?.biggest_move).toBe("Growth Lead");
    expect(payload.brands.find((b) => b.entity_id.startsWith("ent_idle_"))?.biggest_move).toBeNull();
  });

  it("prints it on that brand's line in the brief", async () => {
    const { workspaceId } = await seedHiring();
    const { text } = renderBrief(parseBriefPayload(JSON.stringify(await compose(workspaceId))), {
      unsubscribe_url: "https://0509.io/u/token",
      asset_base_url: "https://assets.0509.io",
    });

    expect(brandLine(text, "Hiring Brand")).toContain("Growth Lead");
    expect(brandLine(text, "Quiet Brand")).not.toContain("Growth Lead");
  });
});

describe("the running total of changes reaches the brief, through real D1", () => {
  const addChanges = async (workspaceId: string, entityId: string, sourceId: string, times: readonly string[]) => {
    await env.DB.batch(
      times.map((observedAt, index) =>
        env.DB.prepare(
          "INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, aspect, dedup_key, observed_at) VALUES (?1, ?2, ?3, ?4, 'change', 'Page changed', 'pricing', ?1, ?5)",
        ).bind(`sig_total_${workspaceId}_${String(index)}`, workspaceId, entityId, sourceId, observedAt),
      ),
    );
  };

  it("counts every change up to the week's close, this week's and earlier ones, and none after", async () => {
    const { workspaceId, hiredEntity } = await seedHiring();
    const sourceRow = await env.DB.prepare("SELECT source_id FROM signal WHERE workspace_id = ?1 LIMIT 1")
      .bind(workspaceId)
      .first<{ source_id: string }>();
    await addChanges(workspaceId, hiredEntity, sourceRow?.source_id ?? "", [
      "2026-08-20T10:00:00.000Z",
      "2026-09-02T10:00:00.000Z",
      "2026-09-16T10:00:00.000Z",
      "2026-09-30T10:00:00.000Z",
    ]);
    const payload = await composeBrief(env.DB, {
      workspaceId,
      schedule: { timezone: "UTC", weekday: 1, hour: 8 },
      week: { startsAt: new Date("2026-09-14T12:00:00.000Z"), closesAt: new Date("2026-09-21T12:00:00.000Z") },
      readThisFirst: { picks: [], judged: 0, unjudged: false },
    });

    expect(payload.checked.site_change_count).toBe(1);
    expect(payload.checked.total_change_count).toBe(3);
  });
});
