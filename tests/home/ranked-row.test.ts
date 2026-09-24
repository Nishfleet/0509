import { describe, expect, it } from "vitest";

import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import type { HomeCount, HomeEntity, HomePill, HomeSource } from "../../app/lib/home-standing";
import { homeStanding } from "../../app/lib/home-standing";

const SCHEDULE: BriefSchedule = { timezone: "Europe/London", weekday: 1, hour: 8 };
const NOW = new Date("2026-09-24T06:30:00.000Z");

const ENTITIES: readonly HomeEntity[] = [
  { id: "ent_self", role: "self", domain: "own.example", state: "on" },
  { id: "ent_kindred", role: "competitor", domain: "kindred.example", state: "on" },
  { id: "ent_casetta", role: "competitor", domain: "casetta.example", state: "on" },
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
    ad_delta: 0,
    mention_delta: 0,
    site_change_count: 0,
    new_roles: 0,
  };
}

function payload(): BriefPayload {
  return {
    workspace_id: "ws_1",
    timezone: "Europe/London",
    period_start: "2026-09-14T07:00:00.000Z",
    period_end: "2026-09-21T07:00:00.000Z",
    headline_rank: 2,
    headline_total: 3,
    headline_movement: 0,
    headline_is_new: false,
    why_line: "Kindred is the mover",
    is_quiet_week: false,
    read_this_first: [],
    brands: [
      brand("ent_kindred", "Kindred", 1, "Kindred dropped a pricing tier"),
      brand("ent_self", "Own Brand", 2, null),
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
}

describe("ranked row view model", () => {
  it("carries each brand's week signal count, why sentence and one source pill per enabled source", () => {
    const standing = homeStanding({
      payload: payload(),
      entities: ENTITIES,
      sources: SOURCES,
      counts: COUNTS,
      schedule: SCHEDULE,
      now: NOW,
    });
    if (standing.kind !== "ranked") throw new Error("expected a ranked standing");

    const kindred = standing.rows.find((row) => row.entityId === "ent_kindred");
    const casetta = standing.rows.find((row) => row.entityId === "ent_casetta");
    if (kindred === undefined || casetta === undefined) throw new Error("expected both rows");

    const kindredPills: readonly HomePill[] = [
      { key: "site-fetch", label: "Your site checks source", count: 3, state: "live" },
      { key: "reddit-mentions", label: "Reddit mentions", count: 0, state: "degraded" },
    ];
    const casettaPills: readonly HomePill[] = [
      { key: "site-fetch", label: "Your site checks source", count: 0, state: "none" },
      { key: "reddit-mentions", label: "Reddit mentions", count: 0, state: "degraded" },
    ];

    expect(kindred.pills).toEqual(kindredPills);
    expect(casetta.pills).toEqual(casettaPills);
    expect(kindred.signals).toBe(3);
    expect(casetta.signals).toBe(0);
    expect(kindred.why).toBe("Kindred dropped a pricing tier");
  });
});
