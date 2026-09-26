import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { HomePageFrame, HomeStanding } from "../../app/components/home-standing";
import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import type { HowRanked } from "../../app/lib/how-ranked";
import {
  greetingFor,
  homeChips,
  homeStanding,
  homeView,
  movementLabel,
  nextHour,
  nextSiteSweepAt,
  type HomeEntity,
  type HomeHistoryRow,
} from "../../app/lib/home-standing";

const SCHEDULE: BriefSchedule = { timezone: "Europe/London", weekday: 1, hour: 8 };
const THURSDAY_MORNING = new Date("2026-09-24T06:30:00.000Z");

const SELF: HomeEntity = { id: "ent_self", role: "self", domain: "own.example", name: "Own Brand", state: "on" };

const ENTITIES: readonly HomeEntity[] = [
  SELF,
  { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
  { id: "ent_casetta", role: "competitor", domain: "casetta.example", name: "Casetta", state: "on" },
];

const SITE_SOURCES = [{ key: "site", kind: "site", platform: "site" }] as const;

function brand(
  entityId: string,
  name: string,
  rank: number | null,
  movement: number | null,
  isNew = false,
  counts: { ad_delta?: number; mention_delta?: number; site_change_count?: number; new_roles?: number } = {},
) {
  return {
    entity_id: entityId,
    name,
    rank,
    movement,
    is_new: isNew,
    biggest_move: null,
    ad_delta: counts.ad_delta ?? 1,
    mention_delta: counts.mention_delta ?? 0,
    site_change_count: counts.site_change_count ?? 0,
    new_roles: counts.new_roles ?? 0,
  };
}

function readMark(signalId: string, entityName: string, title: string) {
  return {
    signal_id: signalId,
    entity_id: `ent_${signalId}`,
    entity_name: entityName,
    title,
    source: "site change",
    observed_at: "2026-09-16T15:30:00.000Z",
    thumbnail_r2_key: null,
    url: `https://${signalId}.example/page`,
    before: "old copy",
    after: "new copy",
    jev_reason: `${entityName} moved.`,
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

const HOW_RANKED: HowRanked = {
  weekStartAt: "2026-09-14T07:00:00.000Z",
  weights: [
    { key: "mention_matters", label: "Mentions that matter", weight: 3 },
    { key: "mention_normal", label: "Mentions", weight: 1 },
    { key: "site_change_noteworthy", label: "Noteworthy site changes", weight: 4 },
    { key: "ad_new_creative", label: "New ad creatives", weight: 2 },
    { key: "ad_copy_change", label: "Ad copy or offer changes", weight: 3 },
    { key: "hiring_new_role", label: "New roles", weight: 1 },
  ],
  multipliers: [
    { reliability: "official_api", label: "Official API", value: 1 },
    { reliability: "rss", label: "RSS feed", value: 0.9 },
    { reliability: "scraped_page", label: "Scraped page", value: 0.6 },
    { reliability: "best_effort", label: "Best effort", value: 0.5 },
  ],
  brands: [{ entityId: "ent_self", name: "Own Brand", lines: [], total: 0 }],
};

function render(input: {
  payload: BriefPayload | null;
  entities?: readonly HomeEntity[];
  howRanked?: HowRanked | null;
}): string {
  const view = homeView({
    payload: input.payload,
    entities: input.entities ?? ENTITIES,
    schedule: SCHEDULE,
    history: [],
    sources: SITE_SOURCES,
    counts: [],
    moves: [],
    now: THURSDAY_MORNING,
  });
  const router = createMemoryRouter([
    { path: "/", element: createElement(HomeStanding, { view, howRanked: input.howRanked }) },
  ]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("Home page frame", () => {
  it("puts the date in the banner, the standing in main, and the footer in contentinfo", () => {
    const html = renderToStaticMarkup(
      createElement(
        HomePageFrame,
        { eyebrow: "Thursday 24 September", footer: "Checked today" },
        createElement("h1", null, "Good morning"),
      ),
    );
    const header = html.indexOf("<header");
    const main = html.indexOf("<main>");
    const footer = html.indexOf("<footer");
    expect(header).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(header);
    expect(footer).toBeGreaterThan(main);
    expect(html).toContain("Thursday 24 September");
    expect(html).toContain("Good morning");
    expect(html).toContain("Checked today");
  });
});

describe("Home standing", () => {
  it("greets with the rank on the marker and the why-line under it", () => {
    const html = render({ payload: payload() });
    expect(html).toContain("Thursday 24 September");
    expect(html).toContain("Good morning. You&#x27;re <span");
    expect(html).toContain(">#2</span> of 3 this week.</h1>");
    expect(html).toContain("Kindred is the mover: 3 new ads and the loudest mention spike");
  });

  it("carries the brief's read-this-first marks onto Home in payload order, capped at three", () => {
    const standing = homeStanding({
      payload: payload({
        read_this_first: [
          readMark("sig_3", "Casetta", "Third pick"),
          readMark("sig_1", "Kindred", "First pick"),
          readMark("sig_4", "Hollow", "Fourth pick"),
          readMark("sig_2", "Oaks", "Second pick"),
        ],
      }),
      entities: ENTITIES,
      schedule: SCHEDULE,
      history: [],
      sources: [],
      counts: [],
      moves: [],
      now: THURSDAY_MORNING,
    });
    if (standing.kind !== "ranked") throw new Error("expected a ranked standing");
    expect(standing.readThisFirst.map((entry) => entry.signal_id)).toEqual(["sig_3", "sig_1", "sig_4"]);
  });

  it("puts the how-ranked trigger under the why-line only when the week has one", () => {
    const withSheet = render({ payload: payload(), howRanked: HOW_RANKED });
    const withoutSheet = render({ payload: payload() });
    expect(withSheet).toContain("How this is ranked");
    expect(withoutSheet).not.toContain("How this is ranked");
  });

  it("lists every ranked brand in rank order with its domain and movement, yours marked", () => {
    const standing = homeStanding({
      payload: payload(),
      entities: ENTITIES,
      schedule: SCHEDULE,
      history: [],
      sources: [],
      counts: [],
      moves: [],
      now: THURSDAY_MORNING,
    });
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
    expect(html).not.toContain("You · ");
  });

  it("puts an unranked brand last with a dash, never a zero", () => {
    const standing = homeStanding({
      payload: payload({ brands: [brand("ent_casetta", "Casetta", null, null), brand("ent_self", "Own Brand", 1, null)] }),
      entities: ENTITIES,
      schedule: SCHEDULE,
      history: [],
      sources: [],
      counts: [],
      moves: [],
      now: THURSDAY_MORNING,
    });
    if (standing.kind !== "ranked") throw new Error("expected a ranked standing");
    expect(standing.rows.map((row) => row.position)).toEqual([1, null]);
    expect(standing.rows[1]?.movement).toBe("first week");
  });

  it("shows a dash for a brand with zero signals this week", () => {
    const p = payload({
      brands: [
        brand("ent_kindred", "Kindred", 1, 0, false, { ad_delta: 2 }),
        brand("ent_casetta", "Casetta", 2, -1, false, {
          ad_delta: 0,
          mention_delta: 0,
          site_change_count: 0,
          new_roles: 0,
        }),
      ],
    });
    const standing = homeStanding({
      payload: p,
      entities: ENTITIES,
      schedule: SCHEDULE,
      history: [],
      sources: SITE_SOURCES,
      counts: [],
      moves: [],
      now: THURSDAY_MORNING,
    });
    if (standing.kind !== "ranked") throw new Error("expected a ranked standing");
    expect(standing.rows.map((row) => row.position)).toEqual([1, null]);
    expect(standing.rows.map((row) => row.signals)).toEqual([0, 0]);
    const html = render({ payload: p });
    expect(html).toContain(">—<");
    expect(html).not.toContain("#1");
  });

  it("asks for a competitor when fewer than two brands are on (REBUILD-STANDING rules)", () => {
    const html = render({
      payload: payload(),
      entities: [SELF, { id: "ent_off", role: "competitor", domain: "off.example", name: "Off Brand", state: "off" }],
    });
    expect(html).toContain("Add a competitor to see where you stand.");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/app/competitors"');
    expect(html).toContain('<input type="hidden" name="intent" value="add"/>');
    expect(html).toContain('name="competitor"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain('href="/onboarding/competitors"');
    expect(html).not.toContain("standing-row");
  });

  it("says when the first standing comes while the first week is still open", () => {
    const html = render({ payload: null });
    expect(html).toContain(
      "We&#x27;re gathering the first week: site snapshots, ads and mentions for 3 brands. The first site snapshots land by Friday 03:00; your first read-this-first comes with the brief on Monday 08:00.",
    );
    expect(html).toContain('data-home="first-file"');
    expect(html).toContain("Good morning.</h1>");
    expect(render({ payload: payload({ headline_rank: null }) })).toContain("gathering the first week");
  });

  it("shows a chip per on and off brand in the gathering state and no chip row once ranked", () => {
    const entities: readonly HomeEntity[] = [
      SELF,
      { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
      { id: "ent_off", role: "competitor", domain: "off.example", name: "Off Brand", state: "off" },
    ];
    const view = homeView({ payload: null, entities, schedule: SCHEDULE, history: [], sources: SITE_SOURCES, counts: [], moves: [], now: THURSDAY_MORNING });
    expect(view.chips).toEqual([
      { name: "Own Brand", href: "/app/settings", self: true, off: false },
      { name: "Kindred", href: "/app/competitors/ent_kindred", self: false, off: false },
      { name: "Off Brand", href: "/app/competitors/ent_off", self: false, off: true },
    ]);

    const gathering = render({ payload: null, entities });
    expect(gathering).toContain('role="group"');
    expect(gathering).toContain('aria-label="Your set"');
    expect(gathering).toContain('href="/app/settings"');
    expect(gathering).toContain('href="/app/competitors/ent_kindred"');
    expect(gathering).toContain("You · Own Brand");
    expect(gathering).toContain("Kindred");
    expect(gathering).toContain('href="/app/competitors/ent_off"');
    expect(gathering).toContain("Off Brand · off");
    expect(gathering).toContain('data-off=""');

    const ranked = render({ payload: payload(), entities });
    expect(ranked).not.toContain('aria-label="Your set"');
  });

  it("lands the first site sweep on the next 02:00Z strictly after now", () => {
    expect(nextSiteSweepAt(new Date("2026-09-24T01:00:00Z"))).toEqual(new Date("2026-09-24T02:00:00Z"));
    expect(nextSiteSweepAt(new Date("2026-09-24T02:00:00Z"))).toEqual(new Date("2026-09-25T02:00:00Z"));
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
      { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
      { id: "ent_casetta", role: "competitor", domain: "casetta.example", name: "Casetta", state: "on" },
      { id: "ent_hollow", role: "competitor", domain: "hollow.example", name: "Hollow", state: "on" },
    ];
    const four = homeView({ payload: payload(), entities: fourOn, schedule: amsterdamSchedule, history: [], sources: SITE_SOURCES, counts: [], moves: [], now });
    expect(four.footer).toBe("Checked 4 brands this week · brief Monday 08:00 · your site re-checked at 13:00");

    const one = homeView({ payload: payload(), entities: [SELF], schedule: amsterdamSchedule, history: [], sources: SITE_SOURCES, counts: [], moves: [], now });
    expect(one.footer).toBe("Checked 1 brand this week · brief Monday 08:00 · your site re-checked at 13:00");
  });
});

const HISTORY_ENTITIES: readonly HomeEntity[] = [
  SELF,
  { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
  { id: "ent_paused", role: "competitor", domain: "paused.example", name: "Paused", state: "off" },
];

const HISTORY: readonly HomeHistoryRow[] = [
  { entity_id: "ent_self", week_start_at: "2026-08-24T07:00:00.000Z", rank: 3 },
  { entity_id: "ent_kindred", week_start_at: "2026-08-24T07:00:00.000Z", rank: 1 },
  { entity_id: "ent_self", week_start_at: "2026-08-31T07:00:00.000Z", rank: 2 },
  { entity_id: "ent_kindred", week_start_at: "2026-08-31T07:00:00.000Z", rank: 1 },
  { entity_id: "ent_paused", week_start_at: "2026-08-31T07:00:00.000Z", rank: 3 },
  { entity_id: "ent_kindred", week_start_at: "2026-09-07T07:00:00.000Z", rank: 2 },
  { entity_id: "ent_paused", week_start_at: "2026-09-07T07:00:00.000Z", rank: 3 },
  { entity_id: "ent_self", week_start_at: "2026-09-14T07:00:00.000Z", rank: 2 },
  { entity_id: "ent_kindred", week_start_at: "2026-09-14T07:00:00.000Z", rank: 1 },
  { entity_id: "ent_self", week_start_at: "2026-09-20T23:00:00.000Z", rank: 1 },
  { entity_id: "ent_kindred", week_start_at: "2026-09-20T23:00:00.000Z", rank: 2 },
];

function chartStanding(history: readonly HomeHistoryRow[]) {
  const standing = homeStanding({
    payload: payload(),
    entities: HISTORY_ENTITIES,
    schedule: SCHEDULE,
    history,
    sources: [],
    counts: [],
    moves: [],
    now: THURSDAY_MORNING,
  });
  if (standing.kind !== "ranked") throw new Error("expected a ranked standing");
  return standing;
}

describe("Home chips", () => {
  it("keeps an off competitor in the row with off true", () => {
    const chips = homeChips([
      SELF,
      { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
      { id: "ent_off", role: "competitor", domain: "off.example", name: "Off Brand", state: "off" },
    ]);
    expect(chips).toContainEqual({ name: "Off Brand", href: "/app/competitors/ent_off", self: false, off: true });
  });

  it("leaves a dismissed competitor out of the row", () => {
    const chips = homeChips([
      SELF,
      { id: "ent_gone", role: "competitor", domain: "gone.example", name: "Gone", state: "dismissed" },
      { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
    ]);
    expect(chips.map((chip) => chip.name)).toEqual(["Own Brand", "Kindred"]);
  });

  it("builds the view's chips with homeChips", () => {
    const entities: readonly HomeEntity[] = [
      { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
      { id: "ent_gone", role: "competitor", domain: "gone.example", name: "Gone", state: "dismissed" },
      { id: "ent_off", role: "competitor", domain: "off.example", name: "Off Brand", state: "off" },
      SELF,
    ];
    const view = homeView({ payload: null, entities, schedule: SCHEDULE, history: [], sources: SITE_SOURCES, counts: [], moves: [], now: THURSDAY_MORNING });
    expect(view.chips).toEqual(homeChips(entities));
    expect(view.chips[0]?.self).toBe(true);
  });
});

describe("four-week chart", () => {
  it("shows four weeks ascending, dropping the oldest, with the London week labelled 21 SEP", () => {
    const standing = chartStanding(HISTORY);
    expect(standing.chart.weeks).toEqual(["31 AUG", "7 SEP", "14 SEP", "21 SEP"]);
  });

  it("keeps a missing week as null, never a zero", () => {
    const standing = chartStanding(HISTORY);
    const self = standing.chart.lines.find((line) => line.entityId === "ent_self");
    expect(self?.ranks).toEqual([2, null, 2, 1]);
  });

  it("marks an entity whose state is off as paused", () => {
    const standing = chartStanding(HISTORY);
    const paused = standing.chart.lines.find((line) => line.entityId === "ent_paused");
    expect(paused?.paused).toBe(true);
    expect(paused?.ranks).toEqual([3, 3, null, null]);
  });

  it("labels the self line YOU and the others by their ranked name", () => {
    const standing = chartStanding(HISTORY);
    const self = standing.chart.lines.find((line) => line.self);
    const kindred = standing.chart.lines.find((line) => line.entityId === "ent_kindred");
    expect(self?.label).toBe("YOU");
    expect(kindred?.label).toBe("Kindred");
  });

  it("leaves every line at length one when only one week is frozen", () => {
    const standing = chartStanding([{ entity_id: "ent_self", week_start_at: "2026-09-20T23:00:00.000Z", rank: 1 }]);
    expect(standing.chart.lines).toHaveLength(1);
    expect(standing.chart.lines[0]?.ranks).toHaveLength(1);
    expect(standing.chart.weeks).toEqual(["21 SEP"]);
  });
});
