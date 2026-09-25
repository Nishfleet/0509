import { describe, expect, it } from "vitest";

import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import type { HomeCount, HomeEntity, HomePill, HomeSource } from "../../app/lib/home-standing";
import { homeStanding } from "../../app/lib/home-standing";

const SCHEDULE: BriefSchedule = { timezone: "Europe/London", weekday: 1, hour: 8 };
const NOW = new Date("2026-09-24T06:30:00.000Z");

const ENTITIES: readonly HomeEntity[] = [
  { id: "ent_self", role: "self", domain: "own.example", name: "Own Brand", state: "on" },
  { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
  { id: "ent_casetta", role: "competitor", domain: "casetta.example", name: "Casetta", state: "on" },
];

const SOURCES: readonly HomeSource[] = [
  { key: "site-fetch", kind: "site", platform: "site" },
  { key: "reddit-mentions", kind: "mentions", platform: "reddit" },
];

const COUNTS: readonly HomeCount[] = [{ entityId: "ent_kindred", sourceKey: "site-fetch", count: 3 }];

function brand(entityId: string, name: string, rank: number, biggestMove: string | null) {
  return {
    entity_id: entityId,
    name,
    rank,
    movement: 0,
    is_new: false,
    biggest_move: biggestMove,
    ad_delta: 1,
    mention_delta: 0,
    site_change_count: 0,
    new_roles: 0,
  };
}

const PAYLOAD: BriefPayload = {
  workspace_id: "ws_1",
  timezone: "Europe/London",
  period_start: "2026-09-14T07:00:00.000Z",
  period_end: "2026-09-21T07:00:00.000Z",
  headline_rank: 2,
  headline_total: 3,
  headline_movement: 1,
  headline_is_new: false,
  why_line: "Kindred is the mover: 3 new ads",
  is_quiet_week: false,
  read_this_first: [],
  brands: [
    brand("ent_self", "Own Brand", 2, null),
    brand("ent_kindred", "Kindred", 1, "Kindred launched 3 new ads"),
    brand("ent_casetta", "Casetta", 3, null),
  ],
  own_site: { status: "ok", incidents: [] },
  checked: {
    mention_count: 0,
    site_change_count: 0,
    new_ad_count: 0,
    source_keys: [],
    degraded_source_keys: [],
    degraded_sources: [{ key: "reddit-mentions", name: null, last_landed_at: null }],
  },
  next_brief_at: null,
};

describe("ranked rows", () => {
  it("carry the week signal count, the why sentence and one pill per source", () => {
    const standing = homeStanding({
      payload: PAYLOAD,
      entities: ENTITIES,
      sources: SOURCES,
      counts: COUNTS,
      history: [],
      schedule: SCHEDULE,
      now: NOW,
    });
    expect(standing.kind).toBe("ranked");
    if (standing.kind !== "ranked") return;
    const kindred = standing.rows.find((row) => row.entityId === "ent_kindred");
    const casetta = standing.rows.find((row) => row.entityId === "ent_casetta");
    if (kindred === undefined || casetta === undefined) throw new Error("expected Kindred and Casetta rows");
    const liveThenDegraded: HomePill["state"][] = ["live", "degraded"];
    const noneThenDegraded: HomePill["state"][] = ["none", "degraded"];
    expect(kindred.pills.map((pill) => pill.state)).toEqual(liveThenDegraded);
    expect(kindred.pills.map((pill) => pill.count)).toEqual([3, 0]);
    expect(casetta.pills.map((pill) => pill.state)).toEqual(noneThenDegraded);
    expect(kindred.signals).toBe(3);
    expect(casetta.signals).toBe(0);
    expect(kindred.why).toBe("Kindred launched 3 new ads");
    expect(casetta.why).toBeNull();
  });
});
