import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { BriefView } from "../../app/components/brief-view";
import { HomeStanding } from "../../app/components/home-standing";
import { ReadThisFirst } from "../../app/components/read-this-first";
import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import { homeStanding, homeView, type HomeEntity } from "../../app/lib/home-standing";
import { UNJUDGED_WEEK_LINE } from "../../app/lib/read-this-first";
import { shareCard } from "../../app/lib/share-card";
import { renderBrief } from "../../workers/delivery/brief-template";

const CONTEXT = { unsubscribe_url: "https://0509.io/u/opaque-token", asset_base_url: "https://assets.0509.io" } as const;
const SCHEDULE: BriefSchedule = { timezone: "Europe/London", weekday: 1, hour: 8 };
const NOW = new Date("2026-09-24T06:30:00.000Z");

const ENTITIES: readonly HomeEntity[] = [
  { id: "ent_self", role: "self", domain: "own.example", name: "Own Brand", state: "on" },
  { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
  { id: "ent_casetta", role: "competitor", domain: "casetta.example", name: "Casetta", state: "on" },
];

function unjudgedPayload(): BriefPayload {
  return {
    workspace_id: "ws_1",
    timezone: "Europe/London",
    period_start: "2026-09-14T07:00:00.000Z",
    period_end: "2026-09-21T07:00:00.000Z",
    headline_rank: null,
    headline_total: 3,
    headline_movement: null,
    headline_is_new: false,
    why_line: UNJUDGED_WEEK_LINE,
    is_quiet_week: false,
    is_unjudged: true,
    read_this_first: [],
    brands: [
      {
        entity_id: "ent_self",
        name: "Own Brand",
        rank: null,
        movement: null,
        is_new: false,
        biggest_move: null,
        ad_delta: 0,
        mention_delta: 0,
        site_change_count: 2,
        new_roles: 0,
      },
      {
        entity_id: "ent_kindred",
        name: "Kindred",
        rank: null,
        movement: null,
        is_new: false,
        biggest_move: null,
        ad_delta: 0,
        mention_delta: 0,
        site_change_count: 5,
        new_roles: 0,
      },
      {
        entity_id: "ent_casetta",
        name: "Casetta",
        rank: null,
        movement: null,
        is_new: false,
        biggest_move: null,
        ad_delta: 0,
        mention_delta: 0,
        site_change_count: 1,
        new_roles: 0,
      },
    ],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 0,
      site_change_count: 8,
      new_ad_count: 0,
      source_keys: ["site.web"],
      degraded_source_keys: [],
      degraded_sources: [],
    },
    next_brief_at: "2026-09-28T07:00:00.000Z",
  };
}

const QUIET = "Nothing this week needed reading first.";
const RANK = /You're #|You're <span|#\d+ of \d+/;

function homeHtml(payload: BriefPayload): string {
  const view = homeView({
    payload,
    entities: ENTITIES,
    schedule: SCHEDULE,
    history: [],
    sources: [],
    counts: [],
    moves: [],
    now: NOW,
  });
  const router = createMemoryRouter([{ path: "/", element: createElement(HomeStanding, { view }) }]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function visible(html: string): string {
  return html.replace(/&#(?:x27|39);|&apos;/gi, "'");
}

describe("unjudged week readers", () => {
  it("renders the not-judged state on the brief, Home rank, share card and read-this-first, never a quiet week or a rank", () => {
    const payload = unjudgedPayload();

    const email = renderBrief(payload, CONTEXT);
    const brief = renderToStaticMarkup(createElement(BriefView, { payload }));
    const first = renderToStaticMarkup(createElement(ReadThisFirst, { marks: payload.read_this_first, unjudged: true }));
    const standing = homeStanding({
      payload,
      entities: ENTITIES,
      schedule: SCHEDULE,
      history: [],
      sources: [],
      counts: [],
      moves: [],
      now: NOW,
    });
    const home = homeHtml(payload);
    const share = shareCard({ payload, entities: ENTITIES, schedule: SCHEDULE, history: [], now: NOW });

    for (const surface of [email.html, email.text, brief, first, home]) {
      const text = visible(surface);
      expect(text).toContain(UNJUDGED_WEEK_LINE);
      expect(text).not.toContain(QUIET);
      expect(text).not.toMatch(RANK);
      expect(text).not.toContain("Quiet week");
      expect(text).not.toContain("gathering the first week");
    }
    expect(email.subject).toBe(UNJUDGED_WEEK_LINE);
    expect(standing.kind).toBe("unjudged");
    expect(share).toBeNull();
  });
});
