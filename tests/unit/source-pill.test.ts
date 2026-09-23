import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SourcePill,
  sourcePillStatus,
  type SourceRow,
  type SourceSnapshot,
} from "../../app/components/source-pill";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

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

const xDisabled: SourceRow = {
  key: "x.search",
  platform: "x",
  is_enabled: 0,
  config_json:
    '{"disabled_reason":"No paid X provider until revenue","decided_by":"Nish","decided_at":"2026-09-22","cheapest_route":{"provider":"Apify","usd_per_1000_tweets":0.40},"approved_cost":null,"source_doc":"docs/engines/mentions.md P5.6"}',
};

const liveSnapshot: SourceSnapshot = {
  item_count: 4,
  fetched_at: "2026-09-22T06:02:00.000Z",
  canary_count: 3,
};

const quietSnapshot: SourceSnapshot = {
  item_count: 0,
  fetched_at: "2026-09-22T06:02:00.000Z",
  canary_count: 3,
};

function pill(source: SourceRow, snapshot: SourceSnapshot | null, now: number = NOW): string {
  const element: ReactElement | null = createElement(SourcePill, { source, snapshot, now });
  return renderToStaticMarkup(element);
}

describe("the source pill", () => {
  it("is one mono-caps pill; live is green and comes from a fresh snapshot with items", () => {
    const html = pill(reddit, liveSnapshot);
    expect(html).toContain('data-state="live"');
    expect(html).toContain("reddit");
    expect(html).toContain("text-transform:uppercase");
    expect(html).toContain("var(--mono, var(--font-mono");
    expect(html).toContain("var(--green, var(--color-green");
    expect(html).toContain("var(--green-ink, var(--color-green-ink");
    expect(html).not.toContain("— none");
    expect(html).not.toContain("— degraded");
    expect(sourcePillStatus(reddit, liveSnapshot, NOW).state).toBe("live");
  });

  it("dims to 'name — none' when a fresh capture produced nothing", () => {
    const html = pill(reddit, quietSnapshot);
    expect(html).toContain('data-state="none"');
    expect(html).toContain("— none");
    expect(html).toContain("var(--ink-soft, var(--color-ink-soft");
    expect(html).not.toContain("var(--green");
    expect(html).not.toContain("var(--color-green");
    expect(sourcePillStatus(reddit, quietSnapshot, NOW).state).toBe("none");
  });

  it("renders a source with no capture at all as degraded, never as quiet-week", () => {
    const html = pill(reddit, null);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("no fresh data");
    expect(html).toContain("last good unknown");
    expect(html).not.toContain("— none");
    expect(sourcePillStatus(reddit, null, NOW).state).toBe("degraded");
  });

  it("dims to degraded with the recorded reason in words and the last-good time", () => {
    const source: SourceRow = {
      ...reddit,
      degraded_reason: "has been rate-limiting us since Friday",
      last_good_at: "2026-09-19T06:02:00.000Z",
    };
    const html = pill(source, quietSnapshot);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("— degraded");
    expect(html).toContain("has been rate-limiting us since Friday");
    expect(html).toContain("last good 2026-09-19 06:02 UTC");
    expect(html).not.toContain("var(--green");
    expect(sourcePillStatus(source, null, NOW).state).toBe("degraded");
  });

  it("marks a zero-canary snapshot as degraded even when items still arrive", () => {
    const silent: SourceSnapshot = {
      item_count: 7,
      fetched_at: "2026-09-22T06:02:00.000Z",
      canary_count: 0,
    };
    const html = pill(reddit, silent);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("not answering");
    expect(html).toContain("last good unknown");
    expect(html).not.toContain('data-state="live"');
    expect(sourcePillStatus(reddit, silent, NOW).state).toBe("degraded");
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
    expect(html).toContain("last good 2026-09-19 06:02 UTC");
    expect(sourcePillStatus(source, liveSnapshot, NOW).lastGoodAt).toBe("2026-09-19T06:02:00.000Z");
  });

  it("says 'no reason recorded' when a degraded row carries no reason", () => {
    const source: SourceRow = { ...reddit, config_json: '{"state":"degraded"}' };
    const html = pill(source, null);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("no reason recorded");
    expect(html).toContain("last good unknown");
  });

  it("renders nothing at all for a disabled source, however the flag arrives", () => {
    expect(pill(parked, liveSnapshot)).toBe("");
    expect(pill({ ...reddit, is_enabled: 0 }, liveSnapshot)).toBe("");
    expect(pill({ ...reddit, is_enabled: false }, liveSnapshot)).toBe("");
    expect(
      pill({ ...reddit, is_enabled: 1, config_json: '{"state":"disabled"}' }, liveSnapshot),
    ).toBe("");
    expect(
      pill({ ...reddit, is_enabled: 1, config_json: '{"state":"parked"}' }, liveSnapshot),
    ).toBe("");
    expect(sourcePillStatus(parked, liveSnapshot, NOW).state).toBe("disabled");
    expect(
      sourcePillStatus({ ...reddit, is_enabled: 1, config_json: '{"state":"parked"}' }, liveSnapshot, NOW).state,
    ).toBe("disabled");
  });

  it("hides the disabled X row as disabled, never degraded, and shows it once only is_enabled flips (#3977)", () => {
    expect(sourcePillStatus(xDisabled, null, NOW).state).toBe("disabled");
    expect(sourcePillStatus(xDisabled, liveSnapshot, NOW).state).toBe("disabled");
    expect(pill(xDisabled, null)).toBe("");
    expect(pill(xDisabled, liveSnapshot)).toBe("");
    const xEnabled: SourceRow = { ...xDisabled, is_enabled: 1 };
    expect(sourcePillStatus(xEnabled, liveSnapshot, NOW).state).toBe("live");
    expect(pill(xEnabled, liveSnapshot)).toContain('data-state="live"');
  });

  it("never colour-codes a pill by which source it is", () => {
    const a = pill(reddit, liveSnapshot).replaceAll("reddit", "SOURCE");
    const b = pill(google, liveSnapshot).replaceAll("google", "SOURCE");
    expect(a).toBe(b);
    const dimA = pill(reddit, quietSnapshot).replaceAll("reddit", "SOURCE");
    const dimB = pill(google, quietSnapshot).replaceAll("google", "SOURCE");
    expect(dimA).toBe(dimB);
    expect(dimA).toContain("— none");
  });

  it("keeps the green tokens off none and degraded entirely", () => {
    const greenBits = ["var(--green", "var(--color-green"];
    for (const html of [
      pill(reddit, quietSnapshot),
      pill(reddit, null),
      pill({ ...reddit, degraded_reason: "rate-limited" }, liveSnapshot),
    ]) {
      for (const bit of greenBits) expect(html).not.toContain(bit);
    }
    for (const bit of greenBits) expect(pill(reddit, liveSnapshot)).toContain(bit);
  });

  it("renders a stale or unparseable capture as degraded with its last-good time", () => {
    const stale: SourceSnapshot = {
      item_count: 9,
      fetched_at: "2026-09-19T06:02:00.000Z",
      canary_count: 3,
    };
    const html = pill(reddit, stale);
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("no fresh data");
    expect(html).toContain("last good 2026-09-19 06:02 UTC");
    expect(html).not.toContain("— none");
    expect(sourcePillStatus(reddit, stale, NOW).state).toBe("degraded");
    const unparseable: SourceSnapshot = { item_count: 9, fetched_at: "yesterday" };
    const unparseableHtml = pill(reddit, unparseable);
    expect(unparseableHtml).toContain('data-state="degraded"');
    expect(unparseableHtml).toContain("last good unknown");
    expect(sourcePillStatus(reddit, unparseable, NOW).state).toBe("degraded");
  });

  it("survives malformed config_json and falls back to the row key for a name", () => {
    for (const raw of ["not json", "[1,2]", "null", "42", '["degraded"]']) {
      const source: SourceRow = { ...reddit, config_json: raw };
      expect(sourcePillStatus(source, liveSnapshot, NOW).state).toBe("live");
    }
    const nameless: SourceRow = { key: "reddit.search_rss", platform: "  ", is_enabled: 1 };
    expect(pill(nameless, liveSnapshot)).toContain("reddit.search_rss");
    expect(
      pill({ ...reddit, last_good_at: "not a date", degraded_reason: "broke" }, liveSnapshot),
    ).toContain("last good not a date");
  });
});
