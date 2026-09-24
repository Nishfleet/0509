import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Ticker } from "../../app/components/landing/ticker";
import { agoLabel, tickerItems, type TickerItem } from "../../app/lib/ticker";

function siteChangeRow(overrides: Partial<{
  id: string;
  entity_name: string | null;
  entity_domain: string;
  payload_json: string;
  observed_at: string;
}> = {}) {
  return {
    id: overrides.id ?? "sig-1",
    entity_name: overrides.entity_name === undefined ? "Acme" : overrides.entity_name,
    entity_domain: overrides.entity_domain ?? "acme.test",
    payload_json:
      overrides.payload_json ??
      JSON.stringify({
        page: { role: "pricing", url: "https://acme.test/pricing" },
        before: { snapshotId: "s1", screenshotKey: null },
        after: { snapshotId: "s2", screenshotKey: null },
        diffKey: null,
        wordsAdded: 1,
        wordsRemoved: 0,
      }),
    observed_at: overrides.observed_at ?? "2026-09-24T12:00:00.000Z",
  };
}

describe("agoLabel", () => {
  it("labels a half-minute change as just now", () => {
    const now = new Date("2026-09-24T12:00:30.000Z");
    expect(agoLabel("2026-09-24T12:00:00.000Z", now)).toBe("just now");
  });

  it("labels minutes, hours and days", () => {
    const now = new Date("2026-09-24T15:00:00.000Z");
    expect(agoLabel("2026-09-24T14:55:00.000Z", now)).toBe("5m ago");
    expect(agoLabel("2026-09-24T12:00:00.000Z", now)).toBe("3h ago");
    expect(agoLabel("2026-09-22T15:00:00.000Z", now)).toBe("2d ago");
  });

  it("clamps a future observation to just now", () => {
    expect(agoLabel("2026-09-24T13:00:00.000Z", new Date("2026-09-24T12:00:00.000Z"))).toBe("just now");
  });
});

describe("tickerItems", () => {
  it("maps a real site-change row to a headline", () => {
    const now = new Date("2026-09-24T12:05:00.000Z");
    const items = tickerItems([siteChangeRow()], now);
    expect(items).toEqual([
      { id: "sig-1", text: "Acme changed its pricing page", ago: "5m ago" } satisfies TickerItem,
    ]);
  });

  it("falls back to the domain when the row has no name", () => {
    const items = tickerItems([siteChangeRow({ entity_name: null })], new Date());
    expect(items[0]?.text).toBe("acme.test changed its pricing page");
  });

  it("drops a row whose payload is not readable", () => {
    const rows = [
      siteChangeRow({ id: "a", payload_json: "not json" }),
      siteChangeRow({ id: "b" }),
    ];
    const items = tickerItems(rows, new Date());
    expect(items.map((item) => item.id)).toEqual(["b"]);
  });

  it("keeps input order and shows at most twelve", () => {
    const rows = Array.from({ length: 20 }, (_unused, index) => siteChangeRow({ id: `sig-${String(index)}` }));
    const items = tickerItems(rows, new Date());
    expect(items).toHaveLength(12);
    expect(items.map((item) => item.id)).toEqual([
      "sig-0",
      "sig-1",
      "sig-2",
      "sig-3",
      "sig-4",
      "sig-5",
      "sig-6",
      "sig-7",
      "sig-8",
      "sig-9",
      "sig-10",
      "sig-11",
    ]);
  });

  it("has no items for no rows, and does not mutate its input", () => {
    const rows: readonly {
      id: string;
      entity_name: string | null;
      entity_domain: string;
      payload_json: string;
      observed_at: string;
    }[] = [];
    expect(tickerItems(rows, new Date())).toEqual([]);
  });
});

describe("Ticker", () => {
  const items: readonly TickerItem[] = [
    { id: "sig-1", text: "Acme changed its pricing page", ago: "5m ago" },
    { id: "sig-2", text: "Acme changed its homepage", ago: "2h ago" },
  ];

  it("reserves its height, loops the strip, and duplicates the list for a seamless loop", () => {
    const html = renderToStaticMarkup(createElement(Ticker, { items }));
    expect(html).toContain('id="ticker"');
    expect(html).toContain("h-9");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html.match(/data-signal-id=/g)).toHaveLength(2);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(1);
  });

  it("keeps its height and drops every looping element when there is nothing to show", () => {
    const html = renderToStaticMarkup(createElement(Ticker, { items: [] }));
    expect(html).toContain('id="ticker"');
    expect(html).toContain("h-9");
    expect(html).not.toContain("<li");
    expect(html).not.toContain("animate-");
  });
});
