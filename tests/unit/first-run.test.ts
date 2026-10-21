import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { BriefView } from "../../app/components/brief-view";
import { parseBriefPayload, type BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import { firstLookRows, isFirstRun, withFirstReadWindow, type FirstLookRival } from "../../app/lib/first-look";
import { homeBriefLink, homeView, type HomeEntity } from "../../app/lib/home-standing";
import { NOTHING_FIRST_LINE } from "../../app/lib/read-this-first";
import { firstBriefLine, firstRunHeadline, quietWeekLine } from "../../app/lib/quiet-week";
import { ownSiteLines } from "../../app/lib/own-site-lines";

const NOW = new Date("2026-10-21T06:30:00.000Z");
const SCHEDULE: BriefSchedule = { timezone: "Europe/London", weekday: 1, hour: 8 };

const ENTITIES: readonly HomeEntity[] = [
  { id: "self", role: "self", domain: "own.example", name: "Own", state: "on" },
  { id: "a", role: "competitor", domain: "a.example", name: "Acme", state: "on" },
  { id: "b", role: "competitor", domain: "b.example", name: "Beta", state: "on" },
];

function rival(overrides: Partial<FirstLookRival> = {}): FirstLookRival {
  return { id: "a", name: "Acme", pages: 0, checkedAt: null, unreadable: false, ...overrides };
}

function emptyPreview(): BriefPayload {
  return parseBriefPayload(
    JSON.stringify({
      workspace_id: "ws",
      timezone: "UTC",
      period_start: "2026-10-19T08:00:00.000Z",
      period_end: "2026-10-26T08:00:00.000Z",
      headline_rank: null,
      headline_total: 0,
      why_line: "Quiet week: nothing new from your competitors.",
      is_quiet_week: true,
      is_unjudged: false,
      read_this_first: [],
      brands: [
        { entity_id: "a", name: "Acme", rank: null, movement: null },
        { entity_id: "b", name: "Beta", rank: null, movement: null },
      ],
      own_site: { status: "ok", incidents: [] },
      checked: { mention_count: 0, site_change_count: 0, new_ad_count: 0 },
      next_brief_at: "2026-10-26T08:00:00.000Z",
    }),
  );
}

function view(props: { payload: BriefPayload; firstRun?: { arrivesAt: string; names: readonly string[] } }): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(BriefView, props)));
}

describe("the first-run brief preview", () => {
  const firstRun = { arrivesAt: "Monday 26 October 2026, 08:00", names: ["Acme", "Beta"] };

  it("heads with when the first brief arrives and says nothing is checked yet", () => {
    const html = view({ payload: emptyPreview(), firstRun });
    expect(html).toContain(
      "Your first brief arrives Monday 26 October 2026, 08:00. Watching 2 competitors from tonight.",
    );
    expect(html).not.toContain("Add a competitor to see where you stand");
  });

  it("never says Quiet week, unranked, your site looks fine or nothing needed your attention", () => {
    const html = view({ payload: emptyPreview(), firstRun });
    expect(html).not.toContain("Quiet week");
    expect(html).not.toContain("unranked");
    expect(html).not.toContain("Your site looks fine");
    expect(html).not.toContain("Nothing needed your attention");
    expect(html).not.toContain("no mentions");
  });

  it("still lists the brands being watched, by name", () => {
    const html = view({ payload: emptyPreview(), firstRun });
    expect(html).toContain("Acme");
    expect(html).toContain("Beta");
  });

  it("says competitor for one", () => {
    expect(firstRunHeadline("Monday 08:00", 1)).toBe(
      "Your first brief arrives Monday 08:00. Watching 1 competitor from tonight.",
    );
  });
});

describe("what counts as the first run", () => {
  it("is every rival unread and not failed, with at least one rival", () => {
    const rows = (rivals: FirstLookRival[]) => firstLookRows(rivals, NOW);
    expect(isFirstRun(rows([rival(), rival({ id: "b" })]))).toBe(true);
    expect(isFirstRun(rows([]))).toBe(false);
    expect(isFirstRun(rows([rival(), rival({ id: "b", pages: 2, checkedAt: "2026-10-21T02:00:00.000Z" })]))).toBe(
      false,
    );
    expect(isFirstRun(rows([rival({ unreadable: true })]))).toBe(false);
  });

  it("marks only unread rivals as pending and gives them the window", () => {
    const rows = firstLookRows(
      [rival(), rival({ id: "b", name: "Beta", pages: 2, checkedAt: "2026-10-21T05:00:00.000Z" })],
      NOW,
    );
    expect(rows.map((row) => row.pending)).toEqual([true, false]);
    expect(rows[0]?.line).toBe("First read tonight");
    const timed = withFirstReadWindow(rows, "between 02:30 and 04:30 GMT+5:30");
    expect(timed[0]?.line).toBe("First read tonight between 02:30 and 04:30 GMT+5:30");
    expect(timed[1]?.line).toBe(rows[1]?.line);
    expect(timed.map((row) => row.line).join()).not.toContain("Reading its site now");
  });
});

describe("Home on the first day", () => {
  const input = {
    payload: null,
    entities: ENTITIES,
    schedule: SCHEDULE,
    history: [],
    sources: [{ key: "site", kind: "site", platform: "site" }],
    counts: [],
    moves: [],
    now: NOW,
  } as const;

  it("says the next check is tonight instead of claiming brands were checked", () => {
    const first = homeView({ ...input, firstRun: true });
    expect(first.footer).toBe("Next check tonight · next brief Monday 08:00 · your own site is re-checked every hour");
    expect(first.footer).not.toContain("Checked");
  });

  it("adds one plain set-up line with the date of the first news", () => {
    const first = homeView({ ...input, firstRun: true });
    expect(first.setUp).toBe("You're set up. Nothing to do. First news: Wednesday 21 October.");
  });

  it("keeps the old footer and has no set-up line once something has been checked", () => {
    const later = homeView({ ...input, firstRun: false });
    expect(later.setUp).toBeNull();
    expect(later.footer).toBe(
      "Checked 3 brands this week · next brief Monday 08:00 · your own site is re-checked every hour",
    );
  });

  it("links to the preview before a brief exists and to the brief after", () => {
    expect(homeBriefLink(false)).toEqual({ to: "/app/brief-preview", label: "See this week's brief so far" });
    expect(homeBriefLink(true)).toEqual({ to: "/app/brief", label: "Read this week's brief" });
  });
});

describe("a workspace with a sent brief keeps its old words", () => {
  it("renders the sent brief view with the quiet, ranked and site lines unchanged", () => {
    const sent = { ...emptyPreview(), headline_rank: 2, headline_total: 3 };
    const html = view({ payload: sent });
    expect(html).toContain("You&#x27;re #2 of 3 this week");
    expect(html).toContain("Acme: unranked");
    expect(html).toContain("Your site looks fine.");
    expect(html).toContain(NOTHING_FIRST_LINE);
  });

  it("leaves the emailed week text byte-identical", () => {
    expect(quietWeekLine(0, 0, 0)).toBe("Quiet week: nothing new from your competitors.");
    expect(quietWeekLine(61, 14, 0)).toBe(
      "Quiet week: we checked 61 mentions and 14 site changes, and none of it needed your attention.",
    );
    expect(firstBriefLine(4)).toBe(
      "This is your starting point: where your 4 competitors stand today, before anything changes. When one moves, your next brief says so.",
    );
    expect(ownSiteLines({ status: "ok", incidents: [] }).headline).toBe("Your site looks fine.");
  });
});
