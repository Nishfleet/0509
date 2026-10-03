import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { env } from "cloudflare:workers";
import type { BriefPayload } from "../../app/lib/brief-payload";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import type { HomeEntity } from "../../app/lib/home-standing";
import { shareCard } from "../../app/lib/share-card";
import { renderShareImage, shareDocument } from "../../app/lib/share-image.server";

const SCHEDULE: BriefSchedule = { timezone: "Europe/London", weekday: 1, hour: 8 };
const NOW = new Date("2026-09-24T06:30:00.000Z");

const ENTITIES: readonly HomeEntity[] = [
  { id: "ent_self", role: "self", domain: "own.example", name: "Own Brand", state: "on" },
  { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
  { id: "ent_casetta", role: "competitor", domain: "casetta.example", name: "Casetta", state: "on" },
];

function brand(entityId: string, name: string, rank: number | null) {
  return {
    entity_id: entityId,
    name,
    rank,
    movement: null,
    is_new: false,
    biggest_move: null,
    ad_delta: 0,
    mention_delta: 0,
    site_change_count: 0,
    new_roles: 0,
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
    headline_movement: null,
    headline_is_new: false,
    why_line: "Kindred is the mover: 3 new ads and the loudest mention spike",
    is_quiet_week: false,
    is_unjudged: false,
    read_this_first: [],
    brands: [brand("ent_casetta", "Casetta", 3), brand("ent_self", "Own Brand", 2), brand("ent_kindred", "Kindred", 1)],
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

function card(overrides: Partial<BriefPayload> = {}) {
  return shareCard({ payload: payload(overrides), entities: ENTITIES, schedule: SCHEDULE, history: [], now: NOW });
}

describe("share card", () => {
  it("carries the owner's brand, rank, total and week, and nothing about competitors", () => {
    expect(card()).toEqual({ brand: "Own Brand", rank: 2, total: 3, week: "Week to 21 September" });
  });

  it("has nothing to share until there is a ranking", () => {
    expect(shareCard({ payload: null, entities: ENTITIES, schedule: SCHEDULE, history: [], now: NOW })).toBeNull();
    expect(card({ headline_rank: null })).toBeNull();
    expect(
      shareCard({ payload: payload(), entities: ENTITIES.slice(0, 1), schedule: SCHEDULE, history: [], now: NOW }),
    ).toBeNull();
  });

  it("shows This week when period_end cannot be parsed (share-card.ts:15)", () => {
    const unparseable = card({ period_end: "not-a-date" });
    if (unparseable === null)
      throw new Error("expected the card to fall back to 'This week' but shareCard returned null");
    expect(unparseable.week).toBe("This week");
  });

  it("formats the week in the schedule's time zone, not in UTC (share-card.ts:16)", () => {
    const london = shareCard({
      payload: payload({ period_end: "2026-09-21T20:00:00.000Z" }),
      entities: ENTITIES,
      schedule: { timezone: "Europe/London", weekday: 1, hour: 8 },
      history: [],
      now: NOW,
    });
    if (london === null) throw new Error("London fixture has no ranking");
    expect(london.week).toBe("Week to 21 September");

    const tokyo = shareCard({
      payload: payload({ period_end: "2026-09-21T20:00:00.000Z" }),
      entities: ENTITIES,
      schedule: { timezone: "Asia/Tokyo", weekday: 1, hour: 8 },
      history: [],
      now: NOW,
    });
    if (tokyo === null) throw new Error("Tokyo schedule fixture has no ranking");
    expect(tokyo.week).toBe("Week to 22 September");
  });
});

describe("share document", () => {
  const ready = card();
  if (ready === null) throw new Error("fixture has no ranking");

  it("draws the rank and 0509 branding with the site's own stylesheet, in light mode", () => {
    const html = shareDocument(ready, "https://0509.io", "/assets/app-abc.css");
    expect(html).toContain('<base href="https://0509.io/">');
    expect(html).toContain('<link rel="stylesheet" href="/assets/app-abc.css">');
    expect(html).toContain('data-theme="light"');
    expect(html).toContain("Own Brand");
    expect(html).toContain(">#2</span> of 3");
    expect(html).toContain("0509.io");
  });

  it("never names a competitor or repeats the why-line", () => {
    const html = shareDocument(ready, "https://0509.io", "/assets/app-abc.css");
    for (const hidden of ["Kindred", "Casetta", "kindred.example", "casetta.example", "mention spike"]) {
      expect(html).not.toContain(hidden);
    }
  });

  it("escapes the brand name", () => {
    const html = shareDocument({ ...ready, brand: "<script>x</script>" }, "https://0509.io", "/a.css");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("share image render", () => {
  it("returns null without a budget callback and logs the miss (0509#5818)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const bytes = await renderShareImage("<p>hi</p>");
      expect(bytes).toBeNull();
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({ event: "share-image-miss", cause: "no browser budget granted" }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("returns null when the budget refuses and logs the miss (0509#5818)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const bytes = await renderShareImage("<p>hi</p>", async () => false);
      expect(bytes).toBeNull();
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({ event: "share-image-miss", cause: "browser budget exhausted" }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("renders the bytes when the budget allows (0509#5818)", async () => {
    const quickAction = vi.fn(async () => new Response("png", { status: 200 }));
    env.BROWSER = { quickAction };
    try {
      const bytes = await renderShareImage("<p>hi</p>", async () => true);
      expect(bytes).not.toBeNull();
      expect(new TextDecoder().decode(bytes as ArrayBuffer)).toBe("png");
      expect(quickAction).toHaveBeenCalledWith("screenshot", expect.objectContaining({ html: "<p>hi</p>" }));
    } finally {
      delete env.BROWSER;
    }
  });
});
