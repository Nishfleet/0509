import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeStanding } from "../../app/components/home-standing";
import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import { greetingFor, homeStanding, homeView, movementLabel, nextHour, type HomeEntity } from "../../app/lib/home-standing";

const SCHEDULE: BriefSchedule = { timezone: "Europe/London", weekday: 1, hour: 8 };
const THURSDAY_MORNING = new Date("2026-09-24T06:30:00.000Z");

const SELF: HomeEntity = { id: "ent_self", role: "self", domain: "own.example", state: "on" };

const ENTITIES: readonly HomeEntity[] = [
  SELF,
  { id: "ent_kindred", role: "competitor", domain: "kindred.example", state: "on" },
  { id: "ent_casetta", role: "competitor", domain: "casetta.example", state: "on" },
];

function brand(entityId: string, name: string, rank: number | null, movement: number | null, isNew = false) {
  return {
    entity_id: entityId,
    name,
    rank,
    movement,
    is_new: isNew,
    biggest_move: null,
    ad_delta: 0,
    mention_delta: 0,
    site_change_count: 0,
  };
}

function payload(overrides: Partial<BriefPayload> = {}): BriefPayload {
  return {
    workspace_id: "ws_1",
    timezone: "Europe/London",
    period_start: "2026-09-14T07:00:00.000Z",
    period_end: "2026-09-21T07:00:00.000Z",
    headline_rank: 2,
    headline_total: 3,
    headline_movement: 1,
    headline_is_new: false,
    why_line: "Kindred is the mover: 3 new ads and the loudest mention spike",
    is_quiet_week: false,
    read_this_first: [],
    brands: [
      brand("ent_casetta", "Casetta", 3, -1),
      brand("ent_self", "Own Brand", 2, 1),
      brand("ent_kindred", "Kindred", 1, 0),
    ],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 12,
      site_change_count: 3,
      new_ad_count: 4,
      source_keys: [],
      degraded_source_keys: [],
      degraded_sources: [],
    },
    next_brief_at: null,
    ...overrides,
  };
}

function render(input: { payload: BriefPayload | null; entities?: readonly HomeEntity[] }): string {
  const view = homeView({
    payload: input.payload,
    entities: input.entities ?? ENTITIES,
    schedule: SCHEDULE,
    now: THURSDAY_MORNING,
  });
  return renderToStaticMarkup(createElement(HomeStanding, { view }));
}

describe("Home standing", () => {
  it("greets with the rank on the marker and the why-line under it", () => {
    const html = render({ payload: payload() });
    expect(html).toContain("Thursday 24 September");
    expect(html).toContain("Good morning. You&#x27;re <span");
    expect(html).toContain(">#2</span> of 3 this week.</h1>");
    expect(html).toContain("Kindred is the mover: 3 new ads and the loudest mention spike");
  });

  it("lists every ranked brand in rank order with its domain and movement, yours marked", () => {
    const standing = homeStanding({ payload: payload(), entities: ENTITIES, schedule: SCHEDULE, now: THURSDAY_MORNING });
    expect(standing.kind).toBe("ranked");
    if (standing.kind !== "ranked") return;
    expect(standing.rows.map((row) => [row.position, row.name, row.domain, row.movement, row.self])).toEqual([
      [1, "Kindred", "kindred.example", "holding steady", false],
      [2, "Own Brand", "own.example", "up 1", true],
      [3, "Casetta", "casetta.example", "down 1", false],
    ]);
    const html = render({ payload: payload() });
    expect(html.match(/data-testid="standing-row"/g)).toHaveLength(3);
    expect(html).toContain('data-self="true"');
    expect(html).toContain("You · ");
  });

  it("puts an unranked brand last with a dash, never a zero", () => {
    const standing = homeStanding({
      payload: payload({ brands: [brand("ent_casetta", "Casetta", null, null), brand("ent_self", "Own Brand", 1, null)] }),
      entities: ENTITIES,
      schedule: SCHEDULE,
      now: THURSDAY_MORNING,
    });
    if (standing.kind !== "ranked") throw new Error("expected a ranked standing");
    expect(standing.rows.map((row) => row.position)).toEqual([1, null]);
    expect(standing.rows[1]?.movement).toBe("first week");
  });

  it("asks for a competitor when fewer than two brands are on (REBUILD-STANDING rules)", () => {
    const html = render({
      payload: payload(),
      entities: [SELF, { id: "ent_off", role: "competitor", domain: "off.example", state: "off" }],
    });
    expect(html).toContain("Add a competitor to see where you stand.");
    expect(html).toContain('href="/onboarding/competitors"');
    expect(html).not.toContain("standing-row");
  });

  it("says when the first standing comes while the first week is still open", () => {
    const html = render({ payload: null });
    expect(html).toContain(
      "We&#x27;re gathering the first week. Your first standing comes with the brief on Monday 08:00.",
    );
    expect(html).toContain("Good morning.</h1>");
    expect(render({ payload: payload({ headline_rank: null }) })).toContain("gathering the first week");
  });

  it("names the movement the way the brief does", () => {
    expect(movementLabel(2, false)).toBe("up 2");
    expect(movementLabel(-3, false)).toBe("down 3");
    expect(movementLabel(0, false)).toBe("holding steady");
    expect(movementLabel(null, false)).toBe("first week");
    expect(movementLabel(1, true)).toBe("new");
  });

  it("greets by the workspace's own clock", () => {
    expect(greetingFor("Europe/London", new Date("2026-09-24T06:30:00.000Z"))).toBe("Good morning");
    expect(greetingFor("Europe/London", new Date("2026-09-24T12:30:00.000Z"))).toBe("Good afternoon");
    expect(greetingFor("Asia/Kolkata", new Date("2026-09-24T12:30:00.000Z"))).toBe("Good evening");
  });

  it("rounds nextHour up to the next hour boundary", () => {
    expect(nextHour(new Date("2026-09-24T10:17:00Z"))).toEqual(new Date("2026-09-24T11:00:00.000Z"));
    expect(nextHour(new Date("2026-09-24T10:00:00Z"))).toEqual(new Date("2026-09-24T11:00:00.000Z"));
  });

  it("builds the footer with the brand count, brief time and own-site re-check, singular for one brand", () => {
    const amsterdamSchedule: BriefSchedule = { timezone: "Europe/Amsterdam", weekday: 1, hour: 8 };
    const now = new Date("2026-09-24T10:17:00Z");
    const fourOn: readonly HomeEntity[] = [
      SELF,
      { id: "ent_kindred", role: "competitor", domain: "kindred.example", state: "on" },
      { id: "ent_casetta", role: "competitor", domain: "casetta.example", state: "on" },
      { id: "ent_hollow", role: "competitor", domain: "hollow.example", state: "on" },
    ];
    const four = homeView({ payload: payload(), entities: fourOn, schedule: amsterdamSchedule, now });
    expect(four.footer).toBe("Checked 4 brands this week · brief Monday 08:00 · your site re-checked at 13:00");

    const one = homeView({ payload: payload(), entities: [SELF], schedule: amsterdamSchedule, now });
    expect(one.footer).toBe("Checked 1 brand this week · brief Monday 08:00 · your site re-checked at 13:00");
  });
});
