import { describe, expect, it } from "vitest";

import { hideOffBrands } from "../../app/lib/agent/hide-off-brands";
import { parseBriefPayload } from "../../app/lib/brief-payload";
import { required } from "../../app/lib/required";

const ON = "ent_on";
const OFF = "ent_off";

function payload(why: string) {
  return parseBriefPayload(
    JSON.stringify({
      workspace_id: "ws",
      timezone: "UTC",
      period_start: "2026-09-25T00:00:00.000Z",
      period_end: "2026-10-02T00:00:00.000Z",
      headline_rank: 2,
      headline_total: 3,
      headline_movement: 0,
      headline_is_new: false,
      why_line: why,
      is_quiet_week: false,
      is_unjudged: false,
      read_this_first: [
        {
          signal_id: "sig_off",
          entity_id: OFF,
          entity_name: "Rival Off",
          title: "Hero",
          source: "site",
          observed_at: "2026-10-02T00:00:00.000Z",
          thumbnail_r2_key: null,
          url: "https://off.example/",
          before: "a",
          after: "b",
          jev_reason: "Hero changed.",
        },
      ],
      brands: [
        {
          entity_id: ON,
          name: "Rival On",
          rank: 1,
          movement: 0,
          is_new: false,
          biggest_move: null,
          ad_delta: 2,
          mention_delta: 0,
          site_change_count: 1,
          new_roles: 0,
        },
        {
          entity_id: OFF,
          name: "Rival Off",
          rank: 1,
          movement: 0,
          is_new: false,
          biggest_move: null,
          ad_delta: 1,
          mention_delta: 4,
          site_change_count: 3,
          new_roles: 0,
        },
      ],
      own_site: { status: "ok", incidents: [] },
      checked: {
        mention_count: 4,
        site_change_count: 4,
        new_ad_count: 3,
        source_keys: [],
        degraded_source_keys: [],
        degraded_sources: [],
      },
      next_brief_at: null,
    }),
  );
}

describe("hideOffBrands", () => {
  it("drops OFF brands from of N, rank, checked counts, and a why line that names them", () => {
    const hidden = hideOffBrands(payload("Rival Off paused, so every brand below it moved up."), new Set([OFF]));
    expect(hidden.brands.map((line) => line.entity_id)).toEqual([ON]);
    expect(hidden.headline_total).toBe(1);
    expect(hidden.headline_rank).toBe(1);
    expect(hidden.checked.mention_count).toBe(0);
    expect(hidden.checked.site_change_count).toBe(1);
    expect(hidden.checked.new_ad_count).toBe(2);
    expect(hidden.why_line).not.toContain("Rival Off");
    expect(hidden.read_this_first).toEqual([]);
  });

  it("rewrites a quiet week with singular nouns for counts of one", () => {
    const template = payload("Rival Off paused, so every brand below it moved up.");
    const brief = {
      ...template,
      brands: template.brands.map((line) =>
        line.entity_id === ON ? { ...line, ad_delta: 1, mention_delta: 1, site_change_count: 1 } : line,
      ),
    };
    expect(hideOffBrands(brief, new Set([OFF])).why_line).toBe("Quiet week: 1 mention, 1 site change, 1 new ad.");
  });

  it("rewrites a led-by line with the judged count the brief was composed with, not the picked count", () => {
    const template = payload("2 of 7 changes worth reading this week, led by Rival Off.");
    const onMark = {
      ...required(template.read_this_first[0], "test.off-mark"),
      signal_id: "sig_on",
      entity_id: ON,
      entity_name: "Rival On",
    };
    const brief = parseBriefPayload(
      JSON.stringify({ ...template, judged_count: 7, read_this_first: [...template.read_this_first, onMark] }),
    );
    const hidden = hideOffBrands(brief, new Set([OFF]));
    expect(hidden.read_this_first.map((mark) => mark.entity_id)).toEqual([ON]);
    expect(hidden.why_line).toBe("1 of 7 changes worth reading this week, led by Rival On.");
  });

  it("keeps a why line that does not name the OFF brand", () => {
    expect(hideOffBrands(payload("You held first on new ads."), new Set([OFF])).why_line).toBe(
      "You held first on new ads.",
    );
  });

  it("does not treat a short brand name as a substring of ordinary prose", () => {
    const template = payload("Continuation of ads this week.");
    const brief = {
      ...template,
      read_this_first: [],
      brands: [
        {
          entity_id: "ent_short",
          name: "on",
          rank: 2,
          movement: 0,
          is_new: false,
          biggest_move: null,
          ad_delta: 0,
          mention_delta: 0,
          site_change_count: 0,
          new_roles: 0,
        },
        ...template.brands.filter((line) => line.entity_id === ON),
      ],
    };
    expect(hideOffBrands(brief, new Set(["ent_short"])).why_line).toBe("Continuation of ads this week.");
  });
});
