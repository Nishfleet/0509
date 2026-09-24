import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  blindSourceNames,
  FreshnessLine,
  freshnessEntries,
  freshnessText,
  type FreshnessEntry,
} from "../../app/components/freshness-line";
import type { SourceRow, SourceSnapshot } from "../../app/components/source-pill";

const NOW = Date.parse("2026-09-24T09:00:00.000Z");

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

const freshSnapshot: SourceSnapshot = {
  fetched_at: "2026-09-24T07:00:00.000Z",
  item_count: 3,
};

function entryFor(source: SourceRow, snapshot: SourceSnapshot | null): FreshnessEntry {
  const entries = freshnessEntries([{ kind: "mentions", source, snapshot }], NOW);
  expect(entries).toHaveLength(1);
  return entries[0];
}

describe("freshness entries", () => {
  it("reports a fresh snapshot as live and formats its landing time", () => {
    const entry = entryFor(reddit, freshSnapshot);

    expect(entry.state).toBe("live");
    expect(freshnessText(entry)).toContain("landed 2026-09-24 07:00 UTC");
  });

  it("hides a disabled source", () => {
    expect(
      freshnessEntries(
        [{ kind: "mentions", source: { ...reddit, is_enabled: 0 }, snapshot: freshSnapshot }],
        NOW,
      ),
    ).toEqual([]);
  });

  it("reports a recorded degraded state with its reason and last-good time", () => {
    const entry = entryFor(
      {
        ...reddit,
        config_json:
          '{"state":"degraded","reason":"blocked by login wall","last_good_at":"2026-09-20T06:00:00.000Z"}',
      },
      freshSnapshot,
    );
    const text = freshnessText(entry);

    expect(entry.state).toBe("degraded");
    expect(text).toContain("blocked by login wall");
    expect(text).toContain("last good 2026-09-20 06:00 UTC");
  });

  it("includes a zero-canary source in the blind list", () => {
    const source: SourceRow = { ...google, key: "google.news_rss" };
    const entries = freshnessEntries(
      [
        { kind: "ads", source, snapshot: { ...freshSnapshot, canary_count: 0 } },
        { kind: "mentions", source: reddit, snapshot: freshSnapshot },
      ],
      NOW,
    );

    expect(entries[0].state).toBe("degraded");
    expect(blindSourceNames(entries)).toContain("Google ads");
  });

  it("renders a source with no snapshot as degraded without showing zero", () => {
    const entry = entryFor(reddit, null);
    const text = freshnessText(entry);

    expect(entry.state).toBe("degraded");
    expect(text).toContain("last good never");
    expect(text).not.toMatch(/\b0\b/);
  });

  it("returns no blind names for an all-live list", () => {
    const entries = freshnessEntries(
      [
        { kind: "mentions", source: reddit, snapshot: freshSnapshot },
        { kind: "ads", source: google, snapshot: freshSnapshot },
      ],
      NOW,
    );

    expect(blindSourceNames(entries)).toEqual([]);
  });
});

describe("the freshness line", () => {
  function line(entries: readonly FreshnessEntry[]): string {
    const element: ReactElement | null = createElement(FreshnessLine, { entries });
    return renderToStaticMarkup(element);
  }

  it("renders nothing when there are no entries", () => {
    expect(line([])).toBe("");
  });

  it("names each entry with its state and separates them", () => {
    const entries = freshnessEntries(
      [
        { kind: "mentions", source: reddit, snapshot: freshSnapshot },
        { kind: "ads", source: google, snapshot: null },
      ],
      NOW,
    );
    const html = line(entries);

    expect(html).toContain('data-home="freshness"');
    expect(html).toContain('data-state="live"');
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain(" · ");
  });
});
