import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  blindSourceNames,
  FreshnessLine,
  freshnessEntries,
  freshnessText,
  type FreshnessEntry,
} from "../../app/components/freshness-line";
import type { SourceRow, SourceSnapshot } from "../../app/components/source-pill";
import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import {
  blindWhyLine,
  homeView,
  type HomeEntity,
} from "../../app/lib/home-standing";

const NOW = Date.parse("2026-09-24T09:00:00.000Z");

const reddit: SourceRow = {
  key: "reddit.search_rss",
  platform: "reddit",
  is_enabled: 1,
};

const google: SourceRow = {
  key: "news.google_rss",
  platform: "google",
  is_enabled: 1,
};

const freshSnapshot: SourceSnapshot = {
  fetched_at: "2026-09-24T07:00:00.000Z",
  item_count: 3,
};

function entryFor(source: SourceRow, snapshot: SourceSnapshot | null): FreshnessEntry {
  const entries = freshnessEntries([{ kind: "mentions", source, snapshot }], NOW);
  expect(entries).toHaveLength(1);
  return entries[0];
}

describe("freshness entries", () => {
  it("reports a fresh snapshot as live and formats its landing time", () => {
    const entry = entryFor(reddit, freshSnapshot);

    expect(entry.state).toBe("live");
    expect(freshnessText(entry)).toContain("landed 2026-09-24 07:00 UTC");
  });

  it("hides a disabled source", () => {
    expect(
      freshnessEntries(
        [{ kind: "mentions", source: { ...reddit, is_enabled: 0 }, snapshot: freshSnapshot }],
        NOW,
      ),
    ).toEqual([]);
  });

  it("reports a recorded degraded state with its reason and last-good time", () => {
    const entry = entryFor(
      {
        ...reddit,
        config_json:
          '{"state":"degraded","reason":"blocked by login wall","last_good_at":"2026-09-20T06:00:00.000Z"}',
      },
      freshSnapshot,
    );
    const text = freshnessText(entry);

    expect(entry.state).toBe("degraded");
    expect(text).toContain("blocked by login wall");
    expect(text).toContain("last good 2026-09-20 06:00 UTC");
  });

  it("includes a zero-canary source in the blind list", () => {
    const source: SourceRow = { ...google, key: "google.news_rss" };
    const entries = freshnessEntries(
      [
        { kind: "ads", source, snapshot: { ...freshSnapshot, canary_count: 0 } },
        { kind: "mentions", source: reddit, snapshot: freshSnapshot },
      ],
      NOW,
    );

    expect(entries[0].state).toBe("degraded");
    expect(blindSourceNames(entries)).toContain("Google ads");
  });

  it("renders a source with no snapshot as degraded without showing zero", () => {
    const entry = entryFor(reddit, null);
    const text = freshnessText(entry);

    expect(entry.state).toBe("degraded");
    expect(text).toContain("last good never");
    expect(text).not.toMatch(/\b0\b/);
  });

  it("returns no blind names for an all-live list", () => {
    const entries = freshnessEntries(
      [
        { kind: "mentions", source: reddit, snapshot: freshSnapshot },
        { kind: "ads", source: google, snapshot: freshSnapshot },
      ],
      NOW,
    );

    expect(blindSourceNames(entries)).toEqual([]);
  });
});

describe("quiet week while blind", () => {
  const SCHEDULE: BriefSchedule = { timezone: "Europe/London", weekday: 1, hour: 8 };
  const THURSDAY_MORNING = new Date("2026-09-24T06:30:00.000Z");

  const ENTITIES: readonly HomeEntity[] = [
    { id: "ent_self", role: "self", domain: "own.example", name: "Own Brand", state: "on" },
    { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
    { id: "ent_casetta", role: "competitor", domain: "casetta.example", name: "Casetta", state: "on" },
  ];

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
      why_line: "Quiet week: 0 mentions checked, 0 site changes, 0 new ads.",
      is_quiet_week: true,
      read_this_first: [],
      brands: [
        {
          entity_id: "ent_casetta",
          name: "Casetta",
          rank: 3,
          movement: -1,
          is_new: false,
          biggest_move: null,
          ad_delta: 1,
          mention_delta: 0,
          site_change_count: 0,
          new_roles: 0,
        },
        {
          entity_id: "ent_self",
          name: "Own Brand",
          rank: 2,
          movement: 1,
          is_new: false,
          biggest_move: null,
          ad_delta: 1,
          mention_delta: 0,
          site_change_count: 0,
          new_roles: 0,
        },
        {
          entity_id: "ent_kindred",
          name: "Kindred",
          rank: 1,
          movement: 0,
          is_new: false,
          biggest_move: null,
          ad_delta: 1,
          mention_delta: 0,
          site_change_count: 0,
          new_roles: 0,
        },
      ],
      own_site: { status: "ok", incidents: [] },
      checked: {
        mention_count: 0,
        site_change_count: 0,
        new_ad_count: 0,
        source_keys: [],
        degraded_source_keys: [],
        degraded_sources: [],
      },
      next_brief_at: null,
      ...overrides,
    };
  }

  it("names the blind sources instead of claiming a quiet week", () => {
    const view = homeView({
      payload: payload(),
      entities: ENTITIES,
      schedule: SCHEDULE,
      history: [],
      sources: [],
      now: THURSDAY_MORNING,
      blindSources: ["Reddit mentions"],
    });

    expect(view.standing.kind).toBe("ranked");
    if (view.standing.kind !== "ranked") return;
    expect(view.standing.whyLine).not.toContain("Quiet week");
    expect(view.standing.whyLine).toContain("Reddit mentions");
  });

  it("keeps the payload why-line when nothing is blind", () => {
    const view = homeView({
      payload: payload(),
      entities: ENTITIES,
      schedule: SCHEDULE,
      history: [],
      sources: [],
      now: THURSDAY_MORNING,
      blindSources: [],
    });

    if (view.standing.kind !== "ranked") throw new Error("expected a ranked standing");
    expect(view.standing.whyLine).toBe(payload().why_line);
  });

  it("keeps a non-quiet why-line even when a source is blind", () => {
    const loud = payload({ is_quiet_week: false });
    const view = homeView({
      payload: loud,
      entities: ENTITIES,
      schedule: SCHEDULE,
      history: [],
      sources: [],
      now: THURSDAY_MORNING,
      blindSources: ["Reddit mentions"],
    });

    if (view.standing.kind !== "ranked") throw new Error("expected a ranked standing");
    expect(view.standing.whyLine).toBe(loud.why_line);
  });

  it("words the blind why-line with every blind source and no trailing comma", () => {
    expect(blindWhyLine(["Reddit mentions"])).toBe(
      "Not a quiet week we can vouch for: Reddit mentions not answering.",
    );
    expect(blindWhyLine(["Reddit mentions", "Google ads"])).toBe(
      "Not a quiet week we can vouch for: Reddit mentions, Google ads not answering.",
    );
  });
});

describe("the freshness line", () => {
  function line(entries: readonly FreshnessEntry[]): string {
    const element: ReactElement | null = createElement(FreshnessLine, { entries });
    return renderToStaticMarkup(element);
  }

  it("renders nothing when there are no entries", () => {
    expect(line([])).toBe("");
  });

  it("names each entry with its state and separates them", () => {
    const entries = freshnessEntries(
      [
        { kind: "mentions", source: reddit, snapshot: freshSnapshot },
        { kind: "ads", source: google, snapshot: null },
      ],
      NOW,
    );
    const html = line(entries);

    expect(html).toContain('data-home="freshness"');
    expect(html).toContain('data-state="live"');
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain(" · ");
  });
});
