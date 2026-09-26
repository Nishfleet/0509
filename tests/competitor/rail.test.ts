import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import {
  CompetitorRail,
  type CompetitorRailProps,
  factLabel,
  type RailFact,
  type RailPeer,
  type RailSource,
  type RailVerdict,
  verdictWords,
} from "../../app/components/competitor-rail";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

const peers: readonly RailPeer[] = [
  { entityId: "comp-on", name: "Kindred", role: "competitor", state: "on", rank: 1 },
  { entityId: "self-a", name: "Acme", role: "self", state: "on", rank: 2 },
  { entityId: "comp-off", name: "Casetta", role: "competitor", state: "off", rank: 3 },
  { entityId: "comp-x", name: "Fieldset", role: "competitor", state: "on", rank: 4 },
];

const facts: readonly RailFact[] = [
  { kind: "change", count: 2 },
  { kind: "hiring", count: 1 },
  { kind: "still_competitor", count: 9 },
];

const sources: readonly RailSource[] = [
  {
    source: { key: "site.web", platform: "web", is_enabled: 1 },
    snapshot: { item_count: 3, fetched_at: "2026-09-22T06:00:00.000Z" },
  },
  {
    source: {
      key: "hiring.greenhouse",
      platform: "greenhouse",
      is_enabled: 1,
      config_json:
        '{"state":"degraded","reason":"rate-limited","last_good_at":"2026-09-19T06:02:00.000Z"}',
    },
    snapshot: null,
  },
];

const verdict: RailVerdict = { choice: "shut_down", decidedAt: "2026-09-17T00:00:00.000Z" };

const props: CompetitorRailProps = {
  entityId: "comp-on",
  peers,
  facts,
  sources,
  verdict,
  lastChecked: "2026-09-22 06:00 UTC",
  now: NOW,
};

function render(overrides: Partial<CompetitorRailProps> = {}): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(CompetitorRail, { ...props, ...overrides })),
  );
}

function text(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

describe("the competitor rail", () => {
  it("draws peers, facts, sources and the still-a-competitor answer in order", () => {
    const html = render();
    const start = html.indexOf('data-slot="competitor-rail"');
    const end = html.lastIndexOf("</aside>");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const rail = html.slice(start, end);
    const markers = [
      'data-section="peers"',
      'data-section="facts"',
      'data-section="sources"',
      'data-section="still-competitor"',
    ];
    let at = -1;
    for (const marker of markers) {
      const index = rail.indexOf(marker);
      expect(index).toBeGreaterThan(at);
      at = index;
    }
  });

  it("keeps peer order, names an off brand in text and links only to other competitors", () => {
    const html = render();
    expect([...html.matchAll(/data-entity-id="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "comp-on",
      "self-a",
      "comp-off",
      "comp-x",
    ]);
    const offRow = html.match(/<li data-entity-id="comp-off"[^>]*>/)?.[0];
    expect(offRow).toContain('data-state="off"');
    expect(offRow).toContain("text-ink-soft");
    expect(offRow).not.toContain("opacity-60");
    expect(text(html)).toContain("Casetta · off");
    expect(text(html)).toContain("You");
    expect(html).toContain('href="/app/competitors/comp-x"');
    expect(html).toContain('href="/app/competitors/comp-off"');
    expect(html).not.toContain('href="/app/competitors/comp-on"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("shows recognized thirty-day facts and drops internal fact kinds", () => {
    const visible = text(render());
    expect(visible).toContain("2 site changes");
    expect(visible).toContain("1 new role");
    expect(visible).not.toContain("still_competitor");
    expect(factLabel("change", 1)).toBe("1 site change");
    expect(factLabel("ad", 2)).toBe("2 ads");
    expect(factLabel("mention", 1)).toBe("1 mention");
    expect(factLabel("still_competitor", 9)).toBeNull();
  });

  it("shows each source's live or degraded state and recorded reason", () => {
    const html = render();
    expect(html).toContain('data-state="degraded"');
    expect(text(html)).toContain("rate-limited");
    expect(html).toContain('data-state="live"');
  });

  it("translates a supported verdict into customer words and a checked date", () => {
    const visible = text(render());
    expect(visible).toContain("Closed or stopped trading.");
    expect(visible).toContain("Checked 17 Sept");
  });

  it("never lets scoring or decision machinery reach the DOM", () => {
    expect(text(render())).not.toMatch(
      /shut_down|still_competitor|question|\bD\d\b|\bp\s*[=:]|\b0\.\d+|probab|confidence|Jev/i,
    );
  });

  it("uses explicit empty states and the first-read source fallback", () => {
    expect(verdictWords("maybe")).toBeNull();
    const unknown = text(render({ verdict: { choice: "maybe", decidedAt: "2026-09-17T00:00:00.000Z" } }));
    expect(unknown).toContain("We ask this every week. The first answer lands after a week of watching.");
    const empty = text(
      render({ peers: [], facts: [], sources: [], verdict: null, lastChecked: null }),
    );
    expect(empty).toContain("No standing yet. It comes with your first weekly brief.");
    expect(empty).toContain("Nothing new from them in the last 30 days.");
    expect(empty).toContain("We ask this every week. The first answer lands after a week of watching.");
    expect(empty).toContain("First read tonight at 02:00 UTC.");
  });
});
