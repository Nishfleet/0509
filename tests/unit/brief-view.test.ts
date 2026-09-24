import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BriefView } from "../../app/components/brief-view";
import { readBriefPayload, type BriefPayload } from "../../app/lib/brief-payload";

function payload(): BriefPayload {
  return {
    workspace_id: "ws_1",
    timezone: "America/New_York",
    period_start: "2026-09-14T12:00:00.000Z",
    period_end: "2026-09-21T12:00:00.000Z",
    headline_rank: 2,
    headline_total: 6,
    headline_movement: 1,
    headline_is_new: false,
    why_line: "Kindred is the mover: 3 new ads and the loudest mention spike",
    is_quiet_week: false,
    read_this_first: [
      {
        signal_id: "sig_1",
        entity_id: "ent_kindred",
        entity_name: "Kindred",
        title: "Pricing page rewritten",
        source: "site change",
        observed_at: "2026-09-16T15:30:00.000Z",
        thumbnail_r2_key: null,
        url: "https://kindred.example/pricing",
        before: "3 tiers",
        after: "2 tiers",
        jev_reason: "A competitor dropping a tier before launch week is the move.",
      },
      {
        signal_id: "sig_2",
        entity_id: "ent_casetta",
        entity_name: "Casetta",
        title: "New creative set",
        source: "Meta ads",
        observed_at: "2026-09-17T09:00:00.000Z",
        thumbnail_r2_key: null,
        url: "https://facebook.example/ads/casetta",
        before: null,
        after: null,
        jev_reason: "Four creatives in five days is spend, not a refresh.",
      },
    ],
    brands: [
      {
        entity_id: "ent_oaks",
        name: "Oaks",
        rank: 1,
        movement: 0,
        is_new: false,
        biggest_move: "Oaks shipped a 2026 pricing page",
        ad_delta: 2,
        mention_delta: 5,
        site_change_count: 1,
      },
      {
        entity_id: "ent_drylight",
        name: "Drylight",
        rank: null,
        movement: -1,
        is_new: false,
        biggest_move: null,
        ad_delta: 0,
        mention_delta: 3,
        site_change_count: 0,
      },
    ],
    own_site: {
      status: "broken",
      incidents: [
        {
          page_url: "https://drylight.example/",
          kind: "cart 500s",
          observed_at: "2026-09-18T09:00:00.000Z",
          is_open: true,
        },
      ],
    },
    checked: {
      mention_count: 12,
      site_change_count: 3,
      new_ad_count: 4,
      source_keys: ["reddit", "hn"],
      degraded_source_keys: [],
      degraded_sources: [],
    },
    next_brief_at: "2026-09-28T13:00:00.000Z",
  };
}

function render(overrides: Partial<BriefPayload> = {}): string {
  return renderToStaticMarkup(createElement(BriefView, { payload: { ...payload(), ...overrides } }));
}

function blocks(html: string): string[] {
  return [...html.matchAll(/data-brief-block="([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("the brief view", () => {
  it("renders the email's five blocks in order", () => {
    expect(blocks(render())).toEqual(["headline", "read-this-first", "brands", "own-site", "checked"]);
    const html = render();
    expect(html).toContain("You&#x27;re #2 of 6 this week");
    expect(html).toContain(
      "12 mentions · 3 site changes · 4 new ads",
    );
    expect(html).toContain("cart 500s on https://drylight.example/ — still broken");
    expect(html).toContain("Oaks — #1 Oaks shipped a 2026 pricing page");
    expect(html).toContain("Drylight — unranked");
  });

  it("shows the struck before and the no-mark row as a link", () => {
    const html = render();
    expect(html).toContain("<s");
    expect(html).toContain("3 tiers");
    expect(html).toContain(`href="https://facebook.example/ads/casetta"`);
    expect(html).toContain("Kindred: A competitor dropping a tier before launch week is the move.");
    expect(render({ read_this_first: [] })).toContain("Nothing this week needed reading first.");
    expect(blocks(render({ read_this_first: [], brands: [] }))).toEqual([
      "headline",
      "read-this-first",
      "brands",
      "own-site",
      "checked",
    ]);
    expect(render({ brands: [] })).toContain("Add a competitor to see where you stand");
    expect(
      render({ own_site: { status: "ok", incidents: [] } }),
    ).toContain("Your site looks fine.");
  });

  it("keeps an unsafe read-this-first URL out of the markup", () => {
    const html = render({
      read_this_first: payload().read_this_first.map((mark) =>
        mark.before === null
          ? { ...mark, title: "Unsafe read-this-first link", url: "javascript:alert(1)" }
          : mark,
      ),
    });

    expect(html).toContain("Unsafe read-this-first link");
    expect(html).not.toContain("javascript:");
  });

  it("never calls a broken site fine because its incident list is empty (0509#4642)", () => {
    const html = render({ own_site: { status: "broken", incidents: [] } });
    expect(html).toContain("Your site looks broken");
    expect(html).not.toContain("Your site looks fine.");
  });

  it("keeps the placeholder headline without a rank and never ships email-only lines", () => {
    expect(render({ headline_rank: null, headline_total: 0 })).toContain(
      "Add a competitor to see where you stand",
    );
    const html = render();
    expect(html).not.toContain("delivered");
    expect(html).not.toContain("Unsubscribe");
    expect(html).toContain("min-w-0");
    expect(html).toContain("break-words");
  });

  it("reads a payload through the parser and returns null when it cannot", () => {
    expect(readBriefPayload('{"html":"x"}')).toBeNull();
    expect(readBriefPayload("not json")).toBeNull();
    const read = readBriefPayload(JSON.stringify(payload()));
    expect(read?.why_line).toBe(payload().why_line);
    expect(read?.read_this_first).toHaveLength(2);
  });
});
