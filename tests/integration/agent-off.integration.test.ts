import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { readAgentBrief, readAgentStanding } from "../../app/lib/agent/read.server";

const NOW = "2026-10-02T12:00:00.000Z";
const USER_ID = "u_agent_off";
const WORKSPACE_ID = "ws_agent_off";
const ON_ID = "ent_agent_off_on";
const OFF_ID = "ent_agent_off_off";

const PAYLOAD = {
  workspace_id: WORKSPACE_ID,
  timezone: "UTC",
  period_start: "2026-09-25T00:00:00.000Z",
  period_end: "2026-10-02T00:00:00.000Z",
  headline_rank: 1,
  headline_total: 2,
  headline_movement: 0,
  headline_is_new: false,
  why_line: "You held first on new ads.",
  is_quiet_week: false,
  is_unjudged: false,
  read_this_first: [
    {
      signal_id: "sig_off_on",
      entity_id: ON_ID,
      entity_name: "Rival On",
      title: "Pricing page changed",
      source: "site",
      observed_at: NOW,
      thumbnail_r2_key: null,
      url: "https://rival-on.example/pricing",
      before: "€10",
      after: "€12",
      jev_reason: "They raised prices.",
    },
    {
      signal_id: "sig_off_off",
      entity_id: OFF_ID,
      entity_name: "Rival Off",
      title: "Homepage changed",
      source: "site",
      observed_at: NOW,
      thumbnail_r2_key: null,
      url: "https://rival-off.example/",
      before: "Hello",
      after: "Hi",
      jev_reason: "They rewrote the hero.",
    },
  ],
  brands: [
    {
      entity_id: ON_ID,
      name: "Rival On",
      rank: 1,
      movement: 0,
      is_new: false,
      biggest_move: null,
      ad_delta: 2,
      mention_delta: 0,
      site_change_count: 1,
      new_roles: 0,
    },
    {
      entity_id: OFF_ID,
      name: "Rival Off",
      rank: 2,
      movement: -1,
      is_new: false,
      biggest_move: null,
      ad_delta: 0,
      mention_delta: 1,
      site_change_count: 1,
      new_roles: 0,
    },
  ],
  own_site: { status: "ok", incidents: [] },
  checked: {
    mention_count: 0,
    site_change_count: 2,
    new_ad_count: 2,
    source_keys: [],
    degraded_source_keys: [],
    degraded_sources: [],
  },
  next_brief_at: "2026-10-09T07:00:00.000Z",
};

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(USER_ID, "Agent Off Owner", "agent-off@test.dev", NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?2, ?3, 'UTC', ?4)",
    ).bind(WORKSPACE_ID, "off", USER_ID, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
    ).bind(ON_ID, WORKSPACE_ID, "rival-on.example", "Rival On", NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'off', ?5)",
    ).bind(OFF_ID, WORKSPACE_ID, "rival-off.example", "Rival Off", NOW),
    env.DB.prepare(
      "INSERT INTO digest (id, workspace_id, kind, period_start, period_end, status, payload_json) VALUES ('dg_agent_off', ?1, 'weekly', ?2, ?3, 'sent', ?4)",
    ).bind(WORKSPACE_ID, PAYLOAD.period_start, PAYLOAD.period_end, JSON.stringify(PAYLOAD)),
  ]);
});

describe("agent brief hides OFF brands", () => {
  it("omits the OFF brand from readAgentBrief and readAgentStanding and keeps the ON one", async () => {
    const { brief } = await readAgentBrief(WORKSPACE_ID);
    expect(brief?.standing.map((line) => line.competitorId)).toEqual([ON_ID]);
    expect(brief?.standing.map((line) => line.name)).toEqual(["Rival On"]);
    expect(brief?.readThisFirst.map((mark) => mark.competitor)).toEqual(["Rival On"]);

    const { standing } = await readAgentStanding(WORKSPACE_ID);
    expect(standing?.lines.map((line) => line.competitorId)).toEqual([ON_ID]);
    expect(standing?.lines.map((line) => line.name)).toEqual(["Rival On"]);
  });
});
