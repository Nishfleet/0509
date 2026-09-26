import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { HomeStanding } from "../../app/components/home-standing";
import { RankedRow } from "../../app/components/ranked-row";
import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import type {
  HomeCount,
  HomeEntity,
  HomePill,
  HomeRow,
  HomeSource,
  WeekEvidence,
} from "../../app/lib/home-standing";
import { homeStanding, homeView } from "../../app/lib/home-standing";
import type { SiteChangeView } from "../../app/lib/site-change";

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
    { ...brand("ent_casetta", "Casetta", 3, null), ad_delta: 0 },
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

const MOVE: SiteChangeView = {
  id: "sig_move_1",
  entityId: "ent_kindred",
  isSelf: false,
  headline: "Kindred changed its homepage",
  page: "homepage",
  url: "https://kindred.example/",
  observedAt: "2026-09-20T10:00:00.000Z",
  capturedAt: "2026-09-20 10:05 UTC",
  wordsChanged: 42,
  sentence: "30 words added, 12 removed.",
  mark: { removed: "Free for every team", added: "Free for open source" },
  before: { missing: "No screenshot of the earlier version" },
  after: { missing: "Screenshot unavailable" },
  whyFlagged: null,
};

function rowsFor(payload: BriefPayload, moves: readonly SiteChangeView[] = []): readonly HomeRow[] {
  const standing = homeStanding({
    payload,
    entities: ENTITIES,
    sources: SOURCES,
    counts: COUNTS,
    history: [],
    schedule: SCHEDULE,
    now: NOW,
    moves,
  });
  if (standing.kind !== "ranked") throw new Error("expected a ranked standing");
  return standing.rows;
}

function rowFor(entityId: string, payload: BriefPayload = PAYLOAD, moves: readonly SiteChangeView[] = []): HomeRow {
  const row = rowsFor(payload, moves).find((entry) => entry.entityId === entityId);
  if (row === undefined) throw new Error(`expected a ${entityId} row`);
  return row;
}
function render(row: HomeRow): string {
  const router = createMemoryRouter([
    {
      path: "/",
      element: createElement("ol", null, createElement(RankedRow, { row, openId: null, evidence: null })),
    },
  ]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("ranked rows carry the week signal count, why and source pills", () => {
  it("builds live, none and degraded pills on the view model", () => {
    const kindred = rowFor("ent_kindred");
    const casetta = rowFor("ent_casetta");
    const kindredPills: readonly HomePill[] = kindred.pills;
    const casettaPills: readonly HomePill[] = casetta.pills;
    expect(kindredPills.map((pill) => pill.state)).toEqual(["live", "degraded"]);
    expect(kindredPills.map((pill) => pill.count)).toEqual([3, 0]);
    expect(casettaPills.map((pill) => pill.state)).toEqual(["none", "degraded"]);
    expect(kindred.signals).toBe(3);
    expect(casetta.signals).toBe(0);
    expect(kindred.why).toBe("Kindred launched 3 new ads");
    expect(casetta.why).toBeNull();
  });
});

describe("RankedRow", () => {
  it("renders the self row's switch as you: disabled and labelled YOU", () => {
    const html = render(rowFor("ent_self"));
    expect(html).toContain('data-slot="brand-switch"');
    expect(html).toContain('data-state="you"');
    expect(html).toContain(">YOU<");
    expect(html).toContain('data-disabled=""');
  });

  it("renders a zero-signal row's position as a dash and never a number", () => {
    const row = rowFor("ent_casetta");
    expect(row.signals).toBe(0);
    expect(row.position).toBeNull();
    const html = render(row);
    expect(html).toContain(">—</span>");
    expect(html).not.toContain(">#");
  });

  it("renders a row with signals as its position", () => {
    expect(render(rowFor("ent_kindred"))).toContain(">#1</span>");
  });

  it("prints a none source as label — none and a degraded source as label — degraded", () => {
    const html = render(rowFor("ent_casetta"));
    expect(html).toContain("Your site checks source — none");
    expect(html).toContain("Reddit mentions — degraded");
  });

  it("prints a source that produced nothing as label — none", () => {
    const html = render(rowFor("ent_casetta", { ...PAYLOAD, checked: { ...PAYLOAD.checked, degraded_sources: [] } }));
    expect(html).toContain("Reddit mentions — none");
  });

  it("prints a live source with its count", () => {
    expect(render(rowFor("ent_kindred"))).toContain("Your site checks source · 3");
  });

  it("prints Why it moved only when the row has a why", () => {
    expect(render(rowFor("ent_kindred"))).toContain("Why it moved: Kindred launched 3 new ads");
    expect(render(rowFor("ent_casetta"))).not.toContain("Why it moved:");
  });

  it("renders the brand's biggest site change of the week as a mark", () => {
    const row = rowFor("ent_kindred", PAYLOAD, [MOVE]);
    expect(row.move?.id).toBe("sig_move_1");
    const html = render(row);
    expect(html).toContain('data-slot="row-move"');
    expect(html).toContain("Free for every team");
    expect(html).toContain("Free for open source");
  });

  it("renders no move block when the brand has no site change this week", () => {
    const row = rowFor("ent_kindred");
    expect(row.move).toBeNull();
    expect(render(row)).not.toContain('data-slot="row-move"');
  });
});

const KINDRED_EVIDENCE: readonly WeekEvidence[] = [
  {
    id: "sig_ev_1",
    sourceKind: "site",
    title: "Pricing page rewrote its hero",
    summary: null,
    url: "https://kindred.example/pricing",
    evidenceUrl: "https://shots.example/ev-1.png",
    observedAt: "2026-09-20T10:00:00.000Z",
  },
  {
    id: "sig_ev_2",
    sourceKind: "site",
    title: null,
    summary: "Docs link added to the nav",
    url: null,
    evidenceUrl: null,
    observedAt: "2026-09-19T09:00:00.000Z",
  },
  {
    id: "sig_ev_3",
    sourceKind: "mentions",
    title: "Kindred mentioned on r/sysadmin",
    summary: null,
    url: "https://www.reddit.com/r/sysadmin/comments/abc",
    evidenceUrl: null,
    observedAt: "2026-09-18T08:00:00.000Z",
  },
];

describe("a ranked row expands in place to the week's evidence", () => {
  function renderStanding(openId: string | null, evidence: readonly WeekEvidence[] | null): string {
    const entries = openId === null ? ["/app"] : [`/app?open=${openId}`];
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: entries },
        createElement(
          "ol",
          null,
          rowsFor(PAYLOAD).map((row) =>
            createElement(RankedRow, { key: row.entityId, row, openId, evidence }),
          ),
        ),
      ),
    );
  }

  it("opens Kindred's row on ?open=ent_kindred with type tabs and its evidence", () => {
    const html = renderStanding("ent_kindred", KINDRED_EVIDENCE);
    expect(html).toContain('data-open="true"');
    expect(html).toContain('aria-controls="evidence-ent_kindred"');
    expect(html).toContain('id="evidence-ent_kindred"');
    expect(html.match(/data-slot="row-evidence"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html).toContain("Site changes 2");
    expect(html).toContain("Mentions 1");
    expect(html).toContain("Ads 0");
    expect(html).toContain("Hiring 0");
    expect(html).toContain("Pricing page rewrote its hero");
    expect(html).toContain('data-slot="evidence-row"');
  });

  it("keeps every row collapsed without an open param", () => {
    const html = renderStanding(null, null);
    expect(html).not.toContain('data-open="true"');
    expect(html).not.toContain('data-slot="row-evidence"');
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
  });
});

describe("below 860px an open ranked row's evidence is a bottom sheet", () => {
  it("server-render keeps the in-place evidence and the sheet stays closed", () => {
    const view = homeView({
      payload: PAYLOAD,
      entities: ENTITIES,
      sources: SOURCES,
      counts: COUNTS,
      history: [],
      schedule: SCHEDULE,
      now: NOW,
      moves: [],
    });
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/app?open=ent_kindred"] },
        createElement(HomeStanding, { view, openId: "ent_kindred", evidence: KINDRED_EVIDENCE }),
      ),
    );
    expect(html.match(/data-slot="row-evidence"/g)).toHaveLength(1);
    expect(html).toContain("Pricing page rewrote its hero");
    expect(html).not.toContain('data-slot="row-sheet"');
  });
});
