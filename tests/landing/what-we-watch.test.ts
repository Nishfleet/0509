import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WhatWeWatch, type WatchedSource } from "../../app/components/landing/what-we-watch";
import type { SourceRow, SourceSnapshot } from "../../app/components/source-pill";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function entry(overrides: {
  kind?: string;
  source: Pick<SourceRow, "key" | "platform" | "is_enabled"> & Partial<SourceRow>;
  snapshot?: SourceSnapshot | null;
}): WatchedSource {
  return {
    kind: overrides.kind ?? "mentions",
    source: overrides.source,
    snapshot: overrides.snapshot ?? null,
  };
}

function markup(sources: readonly WatchedSource[], now: number = NOW): string {
  return renderToStaticMarkup(createElement(WhatWeWatch, { sources, now }));
}

// React serializes the apostrophe in a text node as an entity; decode it so an
// assertion is against the copy as written, not React's escaping.
function decoded(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

const LIVE: SourceSnapshot = { fetched_at: "2026-09-26T11:00:00.000Z", item_count: 12 };

describe("landing what we watch", () => {
  it("renders one pill per enabled registry source, named by plugin_key, in a wrapped row", () => {
    const html = markup([
      entry({ source: { key: "gdelt.doc", name: "gdelt.doc", platform: "gdelt", is_enabled: 1 }, snapshot: LIVE }),
      entry({ source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
      entry({
        kind: "site",
        source: { key: "site.web", name: "site.page", platform: "web", is_enabled: 1 },
        snapshot: LIVE,
      }),
    ]);
    expect(html).toContain("gdelt.doc");
    expect(html).toContain("hn.algolia");
    expect(html).toContain("site.page");
    expect(html.match(/data-state="live"/g)).toHaveLength(3);
    expect(html).toMatch(/<ul class="[^"]*flex-wrap[^"]*"/);
  });

  it("dims a degraded source with its reason and last-good time", () => {
    const html = markup([
      entry({
        source: {
          key: "gdelt.doc",
          name: "gdelt.doc",
          platform: "gdelt",
          is_enabled: 1,
          degraded_reason: "not answering",
          last_good_at: "2026-09-20T03:04:05.000Z",
        },
        snapshot: LIVE,
      }),
      entry({ source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
    ]);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("degraded: not answering");
    expect(html).toContain("last good 2026-09-20 03:04 UTC");
  });

  it("dims an enabled source with no snapshot as degraded, not as live", () => {
    const html = markup([
      entry({ source: { key: "site.web", name: "site.page", platform: "web", is_enabled: 1 }, snapshot: null }),
      entry({
        source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 },
        snapshot: { fetched_at: "2026-09-26T11:00:00.000Z", item_count: 0 },
      }),
    ]);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("degraded: no fresh data");
    expect(html).not.toContain('data-state="live"');
  });

  it("dims a source whose latest snapshot is stale, and a source whose canary is zero", () => {
    const html = markup([
      entry({
        source: { key: "a.one", name: "a.one", platform: "hn", is_enabled: 1 },
        snapshot: { fetched_at: new Date(NOW - 49 * HOUR).toISOString(), item_count: 5 },
      }),
      entry({
        source: { key: "b.two", name: "b.two", platform: "gdelt", is_enabled: 1 },
        snapshot: { fetched_at: "2026-09-26T11:00:00.000Z", item_count: 5, canary_count: 0 },
      }),
      entry({ source: { key: "c.three", name: "c.three", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
    ]);
    expect(html.match(/data-state="degraded"/g)).toHaveLength(2);
    expect(html).toContain("degraded: no fresh data");
    expect(html).toContain("degraded: not answering");
  });

  it("replaces the pill row with the one rebuilding line when every visible source is degraded", () => {
    const html = markup([
      entry({
        source: {
          key: "gdelt.doc",
          name: "gdelt.doc",
          platform: "gdelt",
          is_enabled: 1,
          degraded_reason: "not answering",
          last_good_at: "2026-09-20T03:04:05.000Z",
        },
        snapshot: LIVE,
      }),
      entry({ source: { key: "site.web", name: "site.page", platform: "web", is_enabled: 1 }, snapshot: null }),
    ]);
    const text = decoded(html);
    expect(text).toContain(
      "We're rebuilding coverage of news mentions. Briefs and standing still arrive from site changes; mentions resume as their sources come back.",
    );
    expect(html).not.toContain("data-state=");
    expect(html).not.toContain("last good");
  });

  it("keeps the degraded pills, with their reasons, when a live source is visible too", () => {
    const html = markup([
      entry({
        source: { key: "a.one", name: "a.one", platform: "hn", is_enabled: 1, degraded_reason: "not answering" },
        snapshot: LIVE,
      }),
      entry({
        source: { key: "b.two", name: "b.two", platform: "gdelt", is_enabled: 1, degraded_reason: "rate limited" },
        snapshot: LIVE,
      }),
      entry({ source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
    ]);
    const text = decoded(html);
    expect(text).not.toContain("We're rebuilding coverage of news mentions");
    expect(html).toContain("degraded: not answering");
    expect(html).toContain("degraded: rate limited");
    expect(html.match(/data-state="degraded"/g)).toHaveLength(2);
    expect(html.match(/data-state="live"/g)).toHaveLength(1);
  });

  it("keeps a degraded pill when a none-state source is visible too", () => {
    const html = markup([
      entry({
        source: {
          key: "gdelt.doc",
          name: "gdelt.doc",
          platform: "gdelt",
          is_enabled: 1,
          degraded_reason: "not answering",
        },
        snapshot: LIVE,
      }),
      entry({
        source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 },
        snapshot: { fetched_at: "2026-09-26T11:00:00.000Z", item_count: 0 },
      }),
    ]);
    const text = decoded(html);
    expect(text).not.toContain("We're rebuilding coverage of news mentions");
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain('data-state="none"');
    expect(html).toContain("degraded: not answering");
  });

  it("does not replace the row when every source is disabled", () => {
    const html = markup([
      entry({
        source: { key: "x.search", name: "x.search", platform: "x", is_enabled: 0 },
        snapshot: null,
      }),
    ]);
    const text = decoded(html);
    expect(text).not.toContain("We're rebuilding coverage of news mentions");
    expect(html).not.toContain("data-state=");
  });

  it("says what we watch from the registry kinds it is given, not a list written into the component", () => {
    const html = markup([
      entry({ source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
      entry({
        kind: "site",
        source: { key: "site.web", name: "site.page", platform: "web", is_enabled: 1 },
        snapshot: LIVE,
      }),
      entry({
        kind: "hiring",
        source: { key: "hiring.lever", name: "hiring.board", platform: "lever", is_enabled: 1 },
        snapshot: LIVE,
      }),
    ]);
    expect(html).toContain("We read mentions, site checks, and job posts.");
    expect(html).not.toContain("ads");
  });

  it("explains last good unknown in the lead, above the pill row", () => {
    const html = markup([
      entry({ source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
    ]);
    const sentence =
      "Last good unknown means we haven't yet checked this kind of source. The first check lands in the daily sweep.";
    const text = decoded(html);
    expect(text.indexOf(sentence)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(sentence)).toBeLessThan(text.indexOf("<ul"));
  });

  it("is a wrapped pill row: no card grid, no icons", () => {
    const html = markup([
      entry({ source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
    ]);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("grid");
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("<img");
  });
});
