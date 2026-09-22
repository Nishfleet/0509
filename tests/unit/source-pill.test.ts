import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SourcePill,
  sourcePillStatus,
  type SourceRow,
  type SourceSnapshot,
} from "../../app/components/source-pill";

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

const parked: SourceRow = {
  key: "x.search_parked",
  platform: "x",
  is_enabled: 0,
  config_json: '{"state":"parked","reason":"no reachable surface"}',
};

const liveSnapshot: SourceSnapshot = {
  item_count: 4,
  fetched_at: "2026-09-22T06:02:00.000Z",
  canary_count: 3,
};

function pill(source: SourceRow, snapshot: SourceSnapshot | null): string {
  const element: ReactElement | null = createElement(SourcePill, { source, snapshot });
  return renderToStaticMarkup(element);
}

describe("the source pill", () => {
  it("is one mono-caps pill whose three live states come from the registry row and the latest snapshot", () => {
    const html = pill(reddit, liveSnapshot);
    expect(html).toContain('data-state="live"');
    expect(html).toContain("reddit");
    expect(html).toContain("text-transform:uppercase");
    expect(html).toContain("var(--mono, var(--font-mono");
    expect(html).toContain("var(--green, var(--color-accent");
    expect(html).toContain("var(--green-ink, var(--color-accent-ink");
    expect(html).not.toContain("none");
    expect(html).not.toContain("degraded");
    expect(sourcePillStatus(reddit, liveSnapshot).state).toBe("live");
  });

  it("dims to 'name — none' when the source produced nothing this week", () => {
    const quiet: SourceSnapshot = { item_count: 0, fetched_at: "2026-09-22T06:02:00.000Z", canary_count: 3 };
    const html = pill(reddit, quiet);
    expect(html).toContain('data-state="none"');
    expect(html).toContain("— none");
    expect(html).toContain("var(--ink-soft, var(--color-ink-soft");
    expect(html).not.toContain("var(--green, var(--color-accent");
    expect(pill(reddit, null)).toContain('data-state="none"');
    expect(sourcePillStatus(reddit, quiet).state).toBe("none");
    expect(sourcePillStatus(reddit, null).state).toBe("none");
  });

  it("dims to degraded with the reason in words and the last-good time", () => {
    const source: SourceRow = {
      ...reddit,
      degraded_reason: "has been rate-limiting us since Friday",
      last_good_at: "2026-09-19T06:02:00.000Z",
    };
    const html = pill(source, { item_count: 0, fetched_at: "2026-09-22T06:02:00.000Z" });
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("— degraded");
    expect(html).toContain("has been rate-limiting us since Friday");
    expect(html).toContain("last good");
    expect(html).toContain("19 Sept");
    expect(html).not.toContain("var(--green, var(--color-accent");
    expect(sourcePillStatus(source, null).state).toBe("degraded");
  });

  it("marks a zero-canary snapshot as degraded even when items still arrive", () => {
    const silent: SourceSnapshot = { item_count: 7, fetched_at: "2026-09-22T06:02:00.000Z", canary_count: 0 };
    const html = pill(reddit, silent);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("not answering");
    expect(html).not.toContain('data-state="live"');
    expect(sourcePillStatus(reddit, silent).state).toBe("degraded");
  });

  it("reads the degraded state out of config_json until the canary columns land", () => {
    const source: SourceRow = {
      ...reddit,
      config_json:
        '{"state":"degraded","reason":"not answering since Friday","last_good_at":"2026-09-19T06:02:00.000Z"}',
    };
    const html = pill(source, liveSnapshot);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("not answering since Friday");
    expect(sourcePillStatus(source, liveSnapshot).lastGoodAt).toBe("2026-09-19T06:02:00.000Z");
  });

  it("renders nothing at all for a disabled source", () => {
    expect(pill(parked, liveSnapshot)).toBe("");
    expect(pill({ ...reddit, is_enabled: 0 }, liveSnapshot)).toBe("");
    expect(pill({ ...reddit, is_enabled: false }, liveSnapshot)).toBe("");
    expect(sourcePillStatus(parked, liveSnapshot).state).toBe("disabled");
  });

  it("never colour-codes a pill by which source it is", () => {
    const a = pill(reddit, liveSnapshot).replaceAll("reddit", "SOURCE");
    const b = pill(google, liveSnapshot).replaceAll("google", "SOURCE");
    expect(a).toBe(b);
    const dimA = pill(reddit, { item_count: 0, fetched_at: "2026-09-22T06:02:00.000Z" }).replaceAll(
      "reddit",
      "SOURCE",
    );
    const dimB = pill(google, { item_count: 0, fetched_at: "2026-09-22T06:02:00.000Z" }).replaceAll(
      "google",
      "SOURCE",
    );
    expect(dimA).toBe(dimB);
    expect(dimA).toContain("— none");
  });

  it("keeps a live pill green only for live, never for none or degraded", () => {
    const green = "var(--green, var(--color-accent";
    expect(pill(reddit, liveSnapshot)).toContain(green);
    expect(pill(reddit, null)).not.toContain(green);
    expect(
      pill({ ...reddit, degraded_reason: "rate-limited" }, liveSnapshot),
    ).not.toContain(green);
  });
});
