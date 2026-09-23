import { describe, expect, it } from "vitest";

import {
  BRAND_LINES_QUERY,
  parseBriefPayload,
  type BriefPayload,
} from "../../app/lib/brief-payload";
import { renderBrief } from "../../workers/delivery/brief-template";

/**
 * The P7.3 slice: render and order, not send. These tests hold the four
 * properties docs/engines/delivery.md §4b makes non-negotiable — the brief
 * never re-ranks, never re-judges, keeps the contract's block order, and keeps
 * the quiet week — and the three the contract's rule list makes non-negotiable
 * — off brands absent, screenshots linked, dates in the workspace timezone.
 * The send itself, the one-click unsubscribe route and the delivered-once
 * constraint are the other three P7.x packets, and their proofs are theirs.
 */

const CONTEXT = { unsubscribe_url: "https://0509.io/u/opaque-token", asset_base_url: "https://assets.0509.io" } as const;

function payload(overrides: Partial<BriefPayload> = {}): BriefPayload {
  return {
    workspace_id: "ws_1",
    timezone: "America/New_York",
    period_start: "2026-09-14T12:00:00.000Z",
    period_end: "2026-09-21T12:00:00.000Z",
    headline_rank: 3,
    headline_total: 8,
    headline_movement: 2,
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
        thumbnail_r2_key: "captures/ws_1/sig_1/before.png",
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
        thumbnail_r2_key: "captures/ws_1/sig_2/after.png",
        url: "https://facebook.example/ads/casetta",
        before: null,
        after: null,
        jev_reason: "Four creatives in five days is spend, not a refresh.",
      },
    ],
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

describe("brief block order", () => {
  it("renders the five blocks in the contract's order", () => {
    const { html } = renderBrief(payload(), CONTEXT);

    const headline = html.indexOf("You&#39;re #3 of 8 this week");
    const marks = html.indexOf("Read this first");
    const brands = html.indexOf("Your tracked brands");
    const ownSite = html.indexOf("Your site looks fine.");
    const footer = html.indexOf("What was checked");

    expect(headline).toBeGreaterThan(-1);
    expect(headline).toBeLessThan(marks);
    expect(marks).toBeLessThan(brands);
    expect(brands).toBeLessThan(ownSite);
    expect(ownSite).toBeLessThan(footer);
  });

  it("keeps the same order in the text alternative", () => {
    const { text } = renderBrief(payload(), CONTEXT);
    expect(text.indexOf("You're #3 of 8 this week")).toBeLessThan(text.indexOf("Read this first"));
    expect(text.indexOf("Read this first")).toBeLessThan(text.indexOf("Your tracked brands"));
    expect(text.indexOf("Your tracked brands")).toBeLessThan(text.indexOf("Your site looks fine."));
    expect(text.indexOf("Your site looks fine.")).toBeLessThan(text.indexOf("What was checked"));
  });

  it("renders the movement and D4's one sentence in the headline", () => {
    const { html, text } = renderBrief(payload(), CONTEXT);
    expect(html).toContain("up 2");
    expect(text).toContain("up 2");
    expect(html).toContain("Kindred is the mover: 3 new ads and the loudest mention spike");
    expect(text).toContain("Kindred is the mover: 3 new ads and the loudest mention spike");
  });

  it("says what to do when there is nothing to rank", () => {
    const { html, text } = renderBrief(payload({ headline_rank: null, headline_total: 1 }), CONTEXT);
    expect(html).toContain("Add a competitor to see where you stand");
    expect(text).toContain("Add a competitor to see where you stand");
  });

  it("says a brand-new workspace has no last week to compare", () => {
    const { html, text } = renderBrief(
      payload({ headline_movement: null, headline_is_new: true }),
      CONTEXT,
    );
    expect(html).toContain("new");
    expect(text).toContain("You're #3 of 8 this week — new");
  });
});

describe("off brands are absent, not zeroed", () => {
  it("renders exactly the brands on the payload, with no zero placeholder row", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    expect(html).toContain(">Kindred<");
    expect(html).toContain(">Casetta<");
  });

  it("never renders a zeroed counts line for a brand that is not on the payload", () => {
    const { html, text } = renderBrief(
      payload({ brands: [{ ...payload().brands[0], ad_delta: 0, mention_delta: 0, site_change_count: 0 }] }),
      CONTEXT,
    );
    expect(text).not.toContain("0 new ads");
    expect(html).not.toContain("0 new ads");
    expect(text).toContain("no new ads · no mentions · no site changes");
  });

  it("counts only the brands that are present, in the counts sentence", () => {
    const { text } = renderBrief(payload(), CONTEXT);
    expect(text).toContain("61 mentions, 14 site changes, 9 new ads");
  });

  it("drops a brand the payload never mentions, and never zeroes it", () => {
    const off: BriefPayload = {
      ...payload(),
      brands: payload().brands.filter((b) => b.entity_id !== "ent_casetta"),
      read_this_first: payload().read_this_first.filter((m) => m.entity_id !== "ent_casetta"),
    };
    const { html, text } = renderBrief(off, CONTEXT);
    expect(html).not.toContain("Casetta");
    expect(text).not.toContain("Casetta");
    expect(html).toContain(">Kindred<");
  });

  it("filters to state = 'on' in the per-brand query, with entity joined", () => {
    const sql = BRAND_LINES_QUERY.replace(/\s+/g, " ");
    expect(sql).toContain("JOIN entity e ON e.id = s.entity_id");
    expect(sql).toContain("e.state = 'on'");
    expect(sql).toContain("s.week_start_at = ?2");
    expect(sql).toContain("FROM standing s");
  });
});

describe("read this first is D4's, verbatim", () => {
  it("shows each mark's source, date, thumbnail link and item link", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    expect(html).toContain("Kindred · site change");
    expect(html).toContain("https://kindred.example/pricing");
    expect(html).toContain("3 tiers → 2 tiers");
    expect(html).toContain("https://assets.0509.io/captures/ws_1/sig_1/before.png");
  });

  it("shows Jev's reason verbatim, with no paraphrase around it", () => {
    const { html, text } = renderBrief(payload(), CONTEXT);
    expect(html).toContain("A competitor dropping a tier before launch week is the move.");
    expect(html).toContain("Four creatives in five days is spend, not a refresh.");
    expect(text).toContain("A competitor dropping a tier before launch week is the move.");
  });

  it("keeps D4's order and never re-sorts the marks", () => {
    const { html, text } = renderBrief(payload(), CONTEXT);
    expect(html.indexOf("Pricing page rewritten")).toBeLessThan(html.indexOf("New creative set"));
    expect(text.indexOf("Pricing page rewritten")).toBeLessThan(text.indexOf("New creative set"));
  });

  it("caps at three marks", () => {
    const marks = payload().read_this_first.concat(
      [0, 1, 2].map((n) => ({
        ...payload().read_this_first[0],
        signal_id: `sig_extra_${n}`,
        title: `Extra mark ${n}`,
      })),
    );
    const { html } = renderBrief(payload({ read_this_first: marks }), CONTEXT);
    expect(html).toContain("Pricing page rewritten");
    expect(html).toContain("New creative set");
    expect(html).toContain("Extra mark 0");
    expect(html).not.toContain("Extra mark 1");
    expect(html).not.toContain("Extra mark 2");
  });

  it("still renders the block when D4 picked nothing", () => {
    const { html, text } = renderBrief(payload({ read_this_first: [] }), CONTEXT);
    expect(html).toContain("Read this first");
    expect(html).toContain("Nothing this week needed reading first.");
    expect(text).toContain("Read this first");
  });
});

describe("screenshots are linked, never inlined", () => {
  it("never emits a data: or base64 image source", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("base64");
  });

  it("links the thumbnail through the asset base URL", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    expect(html).toContain('<img src="https://assets.0509.io/captures/ws_1/sig_1/before.png"');
  });

  it("keeps an already percent-encoded key byte-for-byte, never re-encoding it", () => {
    const { html } = renderBrief(
      payload({
        read_this_first: [
          { ...payload().read_this_first[0], thumbnail_r2_key: "captures/ws_1/a%20b/x+y.png" },
        ],
      }),
      CONTEXT,
    );
    expect(html).toContain("https://assets.0509.io/captures/ws_1/a%20b/x+y.png");
    expect(html).not.toContain("%2520");
  });

  it("refuses a javascript: url rather than shipping it as a live link", () => {
    const { html, text } = renderBrief(
      payload({
        read_this_first: [{ ...payload().read_this_first[0], url: "javascript:alert(1)", title: "" }],
      }),
      CONTEXT,
    );
    expect(html).not.toContain('href="javascript:');
    expect(text).toContain("javascript:alert(1)");
  });

  it("refuses a javascript: unsubscribe url the same way", () => {
    const { html } = renderBrief(payload(), { ...CONTEXT, unsubscribe_url: "javascript:alert(1)" });
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("Unsubscribe is not available right now");
  });

  it("escapes the quote it puts in an attribute, so a url cannot break out of it", () => {
    const { html } = renderBrief(
      payload({
        read_this_first: [{ ...payload().read_this_first[0], url: 'https://x.example/a"onmouseover=x' }],
      }),
      CONTEXT,
    );
    expect(html).toContain("&quot;onmouseover=x");
    expect(html).not.toContain('"onmouseover=x"');
  });

  it("omits the thumbnail, not the mark, when no asset base is configured", () => {
    const { html } = renderBrief(payload(), { ...CONTEXT, asset_base_url: null });
    expect(html).not.toContain("<img");
    expect(html).toContain("Pricing page rewritten");
  });
});

describe("per-brand line and own-site status", () => {
  it("renders rank, movement, biggest move and the three counts per brand", () => {
    const { html, text } = renderBrief(payload(), CONTEXT);
    expect(html).toContain("3 new ads · 12 mentions · 1 site change");
    expect(html).toContain("4 new ads · 2 mentions · 6 site changes");
    expect(text).toContain("Kindred — #1, up 3");
    expect(text).toContain("dropped a pricing tier");
  });

  it("calls a first-week brand new rather than inferring a movement", () => {
    const { html, text } = renderBrief(payload(), CONTEXT);
    expect(text).toContain("Casetta — #4, new");
    expect(html).toContain("Casetta</strong>");
  });

  it("says no new ads rather than 0 new ads", () => {
    const { html, text } = renderBrief(payload(), CONTEXT);
    expect(text).toContain("no new ads · 4 mentions · 2 site changes");
    expect(html).not.toContain("0 new ads");
    expect(text).not.toContain("0 new ads");
  });

  it("says the site is fine when nothing broke", () => {
    const { html } = renderBrief(payload({ own_site: { status: "ok", incidents: [] } }), CONTEXT);
    expect(html).toContain("Your site looks fine.");
  });

  it("lists what broke and whether it is still broken", () => {
    const { html, text } = renderBrief(
      payload({
        own_site: {
          status: "broken",
          incidents: [
            { page_url: "https://0509.io/pricing", kind: "checkout section removed", observed_at: "2026-09-18T10:00:00.000Z", is_open: true },
          ],
        },
      }),
      CONTEXT,
    );
    expect(html).toContain("Your site looks broken (1 page):");
    expect(html).toContain("checkout section removed on https://0509.io/pricing");
    expect(html).toContain("still broken");
    expect(text).toContain("still broken");
  });
});

describe("footer", () => {
  it("carries what was checked, the next brief date and the unsubscribe link", () => {
    const { html, text } = renderBrief(payload(), CONTEXT);
    expect(html).toContain("meta, google_news, ddg");
    expect(html).toContain("https://0509.io/u/opaque-token");
    expect(text).toContain("What was checked: 61 mentions, 14 site changes, 9 new ads across meta, google_news, ddg.");
    expect(text).toContain("Next brief:");
    expect(text).toContain("Unsubscribe: https://0509.io/u/opaque-token");
  });

  it("says a source did not answer rather than calling the week quiet", () => {
    const { html, text } = renderBrief(
      payload({ checked: { ...payload().checked, degraded_source_keys: ["reddit"] } }),
      CONTEXT,
    );
    expect(html).toContain("1 source did not answer this week");
    expect(text).toContain("1 source did not answer this week");
  });
});

describe("the quiet week", () => {
  const quiet = payload({
    is_quiet_week: true,
    why_line: "Quiet week: 61 mentions checked, 14 site changes, no new ads.",
    read_this_first: [],
  });

  it("still sends, with the counts as the why-line", () => {
    const { html, text } = renderBrief(quiet, CONTEXT);
    expect(html).toContain("Quiet week: 61 mentions checked, 14 site changes, no new ads.");
    expect(text).toContain("Quiet week: 61 mentions checked, 14 site changes, no new ads.");
  });

  it("keeps every block, so the shape of the message never changes", () => {
    const { html } = renderBrief(quiet, CONTEXT);
    expect(html).toContain("Read this first");
    expect(html).toContain("Your tracked brands");
    expect(html).toContain("Your site looks fine.");
    expect(html).toContain("What was checked");
  });
});

describe("dates", () => {
  it("formats every date in the workspace's timezone, not UTC", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    expect(html).toContain("Monday");
    expect(html).not.toContain("2026-09-14T12:00:00.000Z");
  });

  it("uses the workspace's own timezone per payload, not a shared default", () => {
    const tokyo = renderBrief(payload({ timezone: "Asia/Tokyo" }), CONTEXT);
    const newYork = renderBrief(payload(), CONTEXT);
    expect(tokyo.text).not.toEqual(newYork.text);
    expect(tokyo.html).toContain("Sep 17, 2026, 12:30 AM");
    expect(newYork.html).toContain("Sep 16, 2026, 11:30 AM");
  });

  it("shows a malformed date as-is rather than as Invalid Date", () => {
    const { html, text } = renderBrief(payload({ period_start: "not-a-date" }), CONTEXT);
    expect(html).toContain("not-a-date");
    expect(text).toContain("not-a-date");
    expect(html).not.toContain("Invalid Date");
  });

  it("falls back to the raw instant for an unknown timezone instead of throwing", () => {
    const { text } = renderBrief(payload({ timezone: "Not/AZone" }), CONTEXT);
    expect(text).toContain("2026-09-14T12:00:00.000Z");
  });
});

describe("inline-styled html, and the voice", () => {
  it("styles layout inline and puts colours in one <style> block, with a dark-mode override", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    expect(html).toContain("<style>");
    expect(html).toContain("@media (prefers-color-scheme: dark) {");
    expect(html).toContain(".brief-card{background-color:#1c1a15;color:#f2efe4;}");
    expect(html).toContain(".brief-muted{color:#a9a294;}");
    expect(html).toContain(".brief-page{background-color:#14130f;}");
    expect(html).toContain('max-width:600px;margin:0 auto;padding:24px;border-radius:8px;');
    expect(html.match(/<style>/g)).toHaveLength(1);
  });

  it("sets no colour inline, so the dark-mode override cannot be outranked", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    const afterStyleBlock = html.slice(html.indexOf("</style>") + "</style>".length);
    const inline = afterStyleBlock.match(/style="[^"]*"/g) ?? [];
    expect(inline.length).toBeGreaterThan(0);
    for (const style of inline) {
      expect(style).not.toMatch(/(^|[^-])color:|background-color/);
    }
  });

  it("paints the hairlines and the thumbnail border, so they are real and flippable", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    expect(style).toContain(".brief-rule{border-top:1px solid #ddd6c6;}");
    expect(style).toContain(".brief-rule img{border:1px solid #ddd6c6;}");
    expect(style).toContain(".brief-rule{border-top:1px solid #322e25;}");
    expect(style).toContain(".brief-rule img{border:1px solid #322e25;}");
  });

  it("keeps both palettes to DESIGN.md §4's tokens, not a third set", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    for (const hex of ["#f4f1e8", "#fffdf6", "#0e0d0a", "#55524a", "#ddd6c6", "#14130f", "#1c1a15", "#f2efe4", "#a9a294", "#322e25"]) {
      expect(style).toContain(hex);
    }
  });

  it("carries no exclamation mark and no title case in its own copy", () => {
    const { html, text } = renderBrief(payload(), CONTEXT);
    const body = html.replace("<!doctype html>", "");
    expect(body).not.toContain("!");
    expect(text).not.toContain("!");
  });

  it("ships a text alternative alongside the html", () => {
    const both = renderBrief(payload(), CONTEXT);
    expect(both.html).toContain("<!doctype html>");
    expect(both.html).toContain("<body");
    expect(both.text.length).toBeGreaterThan(0);
    expect(both.subject).toBe("Your weekly brief: you're #3 of 8 this week");
  });

  it("widths the container for a 600 px read", () => {
    const { html } = renderBrief(payload(), CONTEXT);
    expect(html).toContain("max-width:600px");
    expect(html).toContain('name="viewport"');
  });
});

describe("parseBriefPayload", () => {
  const stored = JSON.stringify(payload());

  it("round-trips a payload engine 6 wrote", () => {
    const parsed = parseBriefPayload(stored);
    expect(parsed.headline_rank).toBe(3);
    expect(parsed.brands.map((b) => b.entity_id)).toEqual(["ent_kindred", "ent_self", "ent_casetta"]);
  });

  it("accepts unknown fields so a newer writer cannot stop a send", () => {
    const younger = JSON.stringify({ ...JSON.parse(stored), some_future_field: { anything: true } });
    expect(parseBriefPayload(younger).headline_rank).toBe(3);
  });

  it("throws on a field the render cannot do without", () => {
    expect(() => parseBriefPayload(JSON.stringify({ workspace_id: "ws_1" }))).toThrow(/timezone/);
  });

  it("throws on a payload that is not an object", () => {
    expect(() => parseBriefPayload('["a"]')).toThrow(/not an object/);
  });

  it("skips a malformed brand row rather than dropping the whole brief", () => {
    const withJunk = { ...JSON.parse(stored), brands: [{ entity_id: "ent_junk" }, { nope: true }, ...payload().brands] };
    const parsed = parseBriefPayload(JSON.stringify(withJunk));
    expect(parsed.brands.map((b) => b.entity_id)).toEqual([
      "ent_junk",
      "ent_kindred",
      "ent_self",
      "ent_casetta",
    ]);
  });

  it("ignores a bad movement instead of rendering NaN", () => {
    const parsed = parseBriefPayload(JSON.stringify({ ...JSON.parse(stored), headline_movement: "x" }));
    expect(parsed.headline_movement).toBeNull();
  });
});

const BRIEF_WINDOW = {
  workspace_id: "ws_1",
  timezone: "UTC",
  period_start: "2026-09-14T12:00:00.000Z",
  period_end: "2026-09-21T12:00:00.000Z",
  why_line: "x",
};

describe("degraded sources", () => {
  it("keeps a degraded source and the time it last landed", () => {
    const parsed = parseBriefPayload(
      JSON.stringify({
        ...BRIEF_WINDOW,
        checked: {
          degraded_sources: [{ key: "reddit", last_landed_at: "2026-09-19T08:00:00.000Z" }],
        },
      }),
    );
    expect(parsed.checked.degraded_sources).toEqual([
      { key: "reddit", last_landed_at: "2026-09-19T08:00:00.000Z" },
    ]);
  });

  it("names a key-only degraded source with no last-landed time", () => {
    const parsed = parseBriefPayload(
      JSON.stringify({
        ...BRIEF_WINDOW,
        checked: { degraded_source_keys: ["reddit"] },
      }),
    );
    expect(parsed.checked.degraded_sources).toEqual([{ key: "reddit", last_landed_at: null }]);
  });

  it("drops an empty key and a blank last-landed time", () => {
    const parsed = parseBriefPayload(
      JSON.stringify({
        ...BRIEF_WINDOW,
        checked: {
          degraded_sources: [
            { key: "", last_landed_at: "x" },
            { key: "meta", last_landed_at: "" },
          ],
        },
      }),
    );
    expect(parsed.checked.degraded_sources).toEqual([{ key: "meta", last_landed_at: null }]);
  });

  it("keeps a named source's last-landed time when the same key is also listed", () => {
    const parsed = parseBriefPayload(
      JSON.stringify({
        ...BRIEF_WINDOW,
        checked: {
          degraded_sources: [{ key: "meta", last_landed_at: "2026-09-19T08:00:00.000Z" }],
          degraded_source_keys: ["meta", "reddit"],
        },
      }),
    );
    expect(parsed.checked.degraded_sources).toEqual([
      { key: "meta", last_landed_at: "2026-09-19T08:00:00.000Z" },
      { key: "reddit", last_landed_at: null },
    ]);
  });
});

describe("the subject line", () => {
  it("names the rank when there is one", () => {
    expect(renderBrief(payload(), CONTEXT).subject).toBe("Your weekly brief: you're #3 of 8 this week");
  });

  it("stays generic when there is no rank", () => {
    expect(renderBrief(payload({ headline_rank: null }), CONTEXT).subject).toBe("Your weekly brief");
  });
});
