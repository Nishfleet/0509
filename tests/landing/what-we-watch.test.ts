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

const LIVE: SourceSnapshot = { fetched_at: "2026-09-26T11:00:00.000Z", item_count: 12 };

describe("landing what we watch", () => {
  it("renders one pill per enabled registry source, named by plugin_key, in a wrapped row", () => {
    const html = markup([
      entry({ source: { key: "gdelt.doc", name: "gdelt.doc", platform: "gdelt", is_enabled: 1 }, snapshot: LIVE }),
      entry({ source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
      entry({ kind: "site", source: { key: "site.web", name: "site.page", platform: "web", is_enabled: 1 }, snapshot: LIVE }),
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
    ]);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("degraded: not answering");
    expect(html).toContain("last good 2026-09-20 03:04 UTC");
  });

  it("does not show a disabled source at all", () => {
    const html = markup([
      entry({ source: { key: "x.search", name: "x.search", platform: "x", is_enabled: 0 }, snapshot: LIVE }),
      entry({ source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
    ]);
    expect(html).not.toContain("x.search");
    expect(html).toContain("hn.algolia");
    expect(html.match(/data-state=/g)).toHaveLength(1);
  });

  it("does not show a source whose registry config parks it", () => {
    const html = markup([
      entry({
        kind: "ads",
        source: {
          key: "ads.snap_parked",
          name: "ads.snap_parked",
          platform: "snap",
          is_enabled: 1,
          config_json: '{"state":"parked","reason":"No reachable ad-transparency search surface"}',
        },
        snapshot: LIVE,
      }),
    ]);
    expect(html).not.toContain("ads.snap_parked");
    expect(html).not.toContain("snap");
  });

  it("dims an enabled source with no snapshot as degraded, not as live", () => {
    const html = markup([
      entry({ source: { key: "site.web", name: "site.page", platform: "web", is_enabled: 1 }, snapshot: null }),
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
    ]);
    expect(html.match(/data-state="degraded"/g)).toHaveLength(2);
    expect(html).toContain("degraded: no fresh data");
    expect(html).toContain("degraded: not answering");
  });

  it("says what we watch from the registry kinds, not a list written into the component", () => {
    const html = markup([
      entry({ source: { key: "hn.algolia", name: "hn.algolia", platform: "hn", is_enabled: 1 }, snapshot: LIVE }),
      entry({ kind: "site", source: { key: "site.web", name: "site.page", platform: "web", is_enabled: 1 }, snapshot: LIVE }),
      entry({ kind: "hiring", source: { key: "hiring.lever", name: "hiring.board", platform: "lever", is_enabled: 0 } }),
    ]);
    expect(html).toContain("We read mentions and site checks.");
    expect(html).not.toContain("job posts");
    expect(html).not.toContain("ads");
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
