import { describe, expect, it } from "vitest";

import { type BriefPayload } from "../../app/lib/brief-payload";
import { renderBrief } from "../../workers/delivery/brief-template";
import { pausedSentence } from "../../workers/standing/compose-brief";

/**
 * The quiet week is the one block the brief is allowed to drop: an empty
 * read-this-first would render as "Nothing this week needed reading first.",
 * which is a lie on a week D4 had nothing to say. And when engine 5's
 * canaries are red the brief must not claim a quiet week at all — it names
 * the blind sources and when they last landed, per docs/engines/standing-home.md §7.
 */

const CONTEXT = { unsubscribe_url: "https://0509.io/u/opaque-token", asset_base_url: "https://assets.0509.io" } as const;

function quiet(overrides: Partial<BriefPayload> = {}): BriefPayload {
  return {
    workspace_id: "ws_1",
    timezone: "America/New_York",
    period_start: "2026-09-14T12:00:00.000Z",
    period_end: "2026-09-21T12:00:00.000Z",
    headline_rank: 3,
    headline_total: 8,
    headline_movement: 2,
    headline_is_new: false,
    why_line: "Quiet week: 61 mentions checked, 14 site changes, no new ads.",
    is_quiet_week: true,
    read_this_first: [],
    brands: [
      {
        entity_id: "ent_kindred",
        name: "Kindred",
        rank: 1,
        movement: 3,
        is_new: false,
        biggest_move: "dropped a pricing tier",
        ad_delta: 3,
        mention_delta: 12,
        site_change_count: 1,
      },
      {
        entity_id: "ent_self",
        name: "Five to Nine",
        rank: 3,
        movement: 2,
        is_new: false,
        biggest_move: null,
        ad_delta: 0,
        mention_delta: 4,
        site_change_count: 2,
      },
      {
        entity_id: "ent_casetta",
        name: "Casetta",
        rank: 4,
        movement: null,
        is_new: true,
        biggest_move: "launched a careers page",
        ad_delta: 4,
        mention_delta: 2,
        site_change_count: 6,
      },
    ],
    own_site: { status: "ok", incidents: [] },
    checked: {
      mention_count: 61,
      site_change_count: 14,
      new_ad_count: 9,
      source_keys: ["meta", "google_news", "ddg"],
      degraded_source_keys: [],
      degraded_sources: [],
    },
    next_brief_at: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

describe("paused competitor sentences", () => {
  it("returns null when no competitor paused", () => {
    expect(pausedSentence([])).toBeNull();
  });

  it("uses singular movement language for one paused competitor", () => {
    expect(pausedSentence(["Casetta"])).toBe("Casetta paused, so every brand below it moved up.");
  });

  it("lists multiple paused competitors in the order they paused", () => {
    expect(pausedSentence(["Casetta", "Kindred", "Noul"])).toBe(
      "Casetta, Kindred and Noul paused, so every brand below them moved up.",
    );
  });
});

describe("the quiet week brief", () => {
  it("still sends the headline and counts, and drops the empty read-this-first block", () => {
    const { html, text } = renderBrief(quiet(), CONTEXT);
    expect(text).toContain("Quiet week: 61 mentions checked, 14 site changes, no new ads.");
    expect(text).toContain("You're #3 of 8 this week");
    expect(html).not.toContain("Read this first");
    expect(text).not.toContain("Read this first");
    expect(html).toContain("Your tracked brands");
    expect(html).toContain("Your site looks fine.");
    expect(html).toContain("What was checked");
    expect(text).not.toContain("!");
  });

  it("names a blind source and when it last landed instead of claiming a quiet week", () => {
    const { text } = renderBrief(
      quiet({
        checked: {
          ...quiet().checked,
          degraded_source_keys: ["reddit"],
          degraded_sources: [
            { key: "reddit.search", name: "Reddit mentions", last_landed_at: "2026-09-19T08:00:00.000Z" },
          ],
        },
      }),
      CONTEXT,
    );
    expect(text).toContain("Reddit mentions has not answered since");
    expect(text).not.toContain("reddit.search");
    expect(text).toContain("so this is not a quiet week we can vouch for.");
    expect(text).not.toContain("Quiet week");
    expect(text).not.toContain("2026-09-19T08:00:00.000Z");
  });

  it("says a blind source has not answered yet when it never landed", () => {
    const { text } = renderBrief(
      quiet({
        checked: {
          ...quiet().checked,
          degraded_sources: [{ key: "reddit.search", name: null, last_landed_at: null }],
        },
      }),
      CONTEXT,
    );
    expect(text).toContain("One of your sources has not answered yet");
    expect(text).not.toContain("reddit.search");
  });

  it("keeps the read-this-first block on a non-quiet week", () => {
    const { html } = renderBrief(
      quiet({
        is_quiet_week: false,
        why_line: "Kindred is the mover: 3 new ads and the loudest mention spike",
        read_this_first: [
          {
            signal_id: "sig_1",
            entity_id: "ent_kindred",
            entity_name: "Kindred",
            title: "Pricing page rewritten",
            source: "site change",
            observed_at: "2026-09-16T15:30:00.000Z",
            thumbnail_r2_key: "captures/ws_1/sig_1/before.png",
            url: "https://kindred.example/pricing",
            before: "3 tiers",
            after: "2 tiers",
            jev_reason: "A competitor dropping a tier before launch week is the move.",
          },
        ],
      }),
      CONTEXT,
    );
    expect(html).toContain("Read this first");
  });
});
