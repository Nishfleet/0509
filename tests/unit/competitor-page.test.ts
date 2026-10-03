import { createElement, Fragment, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { CompetitorFrame, type CompetitorFrameProps, developmentsEmpty } from "../../app/components/competitor-frame";
import type { RailSource } from "../../app/components/competitor-rail";
import type { SiteChangeItemData } from "../../app/components/site-change-item";
import type { BiggestMoveView } from "../../app/lib/biggest-move";
import { LOST_CHANNEL_REASON } from "../../app/lib/mentions/youtube-channel";
import {
  CompetitorHeader,
  competitorPausedLine,
  type CompetitorHeaderProps,
} from "../../app/components/competitor-header";

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

const change: SiteChangeItemData = {
  id: "sig-1",
  entityId: "ent-kindred",
  isSelf: false,
  headline: "Kindred changed its homepage",
  page: "homepage",
  url: "https://kindred.example/",
  observedAt: "2026-09-24T02:10:00.000Z",
  capturedAt: "2026-09-24 02:09 UTC",
  wordsChanged: 5,
  provenance: null,
  sentence: "3 words added, 2 removed.",
  mark: { removed: "Plans from $10.", added: "Plans from $12." },
  before: { src: "/app/changes/sig-1/before", capturedAt: "2026-09-23 02:09 UTC" },
  after: { src: "/app/changes/sig-1/after", capturedAt: "2026-09-24 02:09 UTC" },
  whyFlagged: null,
  when: "today",
};

const move: BiggestMoveView = {
  id: "sig-1",
  kind: "change",
  source: "Site change · website",
  title: "Kindred changed its homepage",
  url: null,
  when: "today",
  read: "Price change: 5 × 1 = 5 points, the most of anything this brand did this week.",
  weight: 5,
  multiplier: 1,
  points: 5,
};

const quiet: CompetitorFrameProps = {
  changes: [],
  developments: [],
  weekCount: 0,
  biggestMove: null,
  quiet:
    "Nothing worth scoring for this competitor in the last 7 days. We checked website, last at 2026-09-24 02:09 UTC.",
  pages: 0,
  lastChecked: null,
  pausedOn: null,
  unreadable: false,
  rail: {
    entityId: "ent-1",
    peers: [],
    facts: [],
    sources: [],
    verdict: null,
    now: Date.parse("2026-09-22T12:00:00.000Z"),
  },
};

function frame(props: Partial<CompetitorFrameProps> = {}): string {
  return render(createElement(CompetitorFrame, { ...quiet, ...props }));
}

function header(props: CompetitorHeaderProps): string {
  return render(createElement(CompetitorHeader, props));
}

describe("the competitor page frame", () => {
  it("says plainly when the rival's website could not be read, and says nothing otherwise", () => {
    expect(frame({ unreadable: true })).toContain("We couldn&#x27;t read their website");
    expect(frame({ unreadable: true })).toContain("keep trying");
    expect(frame()).not.toContain("read their website");
  });

  it("formats the paused line in en-GB UTC", () => {
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z")).toBe("Paused 22 Sept");
    expect(competitorPausedLine(null)).toBe("Paused");
    expect(competitorPausedLine("not a date")).toBe("Paused");
    expect(competitorPausedLine("not a date", "shut_down")).toBe("Paused · looks like it shut down");
  });

  it("reads state_reason in lowercase customer words and never shows a code", () => {
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z", "acquired")).toBe(
      "Paused 22 Sept · looks like it was acquired",
    );
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z", "shut_down")).toBe(
      "Paused 22 Sept · looks like it shut down",
    );
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z", "some_code")).toBe("Paused 22 Sept");
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z", "constructor")).toBe("Paused 22 Sept");
    const html = header({
      name: "Kindred",
      domain: "kindred.example",
      state: "off",
      stateChangedAt: "2026-09-22T12:00:00.000Z",
      stateReason: "shut_down",
    });
    expect(html).toContain("looks like it shut down");
    expect(html).not.toContain("shut_down");
  });

  it("makes the breadcrumb link a 44px-tall tap target", () => {
    const html = header({ name: "Kindred", domain: "kindred.example", state: "on", stateChangedAt: null });
    const link = html.match(/<a\b[^>]*href="\/app\/competitors"[^>]*>/)?.[0] ?? "";
    expect(link).toContain("min-h-11");
  });

  it("renders the blocks in DESIGN.md 2.5 order", () => {
    const html = render(
      createElement(
        Fragment,
        null,
        createElement(CompetitorHeader, {
          name: "Kindred",
          domain: "kindred.example",
          state: "on",
          stateChangedAt: null,
          control: createElement("span", { "data-testid": "control-slot" }),
        }),
        createElement(CompetitorFrame, { ...quiet, changes: [change], weekCount: 1, biggestMove: move }),
      ),
    );
    const markers = [
      'aria-label="Breadcrumb"',
      "<h1",
      'data-testid="control-slot"',
      'data-section="snapshot"',
      'data-section="biggest-move"',
      'data-section="developments"',
      'data-slot="competitor-rail"',
      'data-section="peers"',
      'data-section="facts"',
      'data-section="sources"',
      'data-section="still-competitor"',
    ];
    let at = -1;
    for (const marker of markers) {
      const index = html.indexOf(marker);
      expect(index).toBeGreaterThan(at);
      at = index;
    }
  });

  it("shows the paused line only when the brand is off", () => {
    const on = header({
      name: "Kindred",
      domain: "kindred.example",
      state: "on",
      stateChangedAt: null,
    });
    expect(on).not.toContain('data-slot="competitor-paused"');
    const off = header({
      name: "Kindred",
      domain: "kindred.example",
      state: "off",
      stateChangedAt: "2026-09-22T12:00:00.000Z",
    });
    expect(off).toContain("Paused 22 Sept");
  });

  it("names every snapshot cell with a real value and never says no data", () => {
    const html = frame({ weekCount: 2, pages: 1, lastChecked: "2026-09-24 02:09 UTC" });
    for (const label of ["Site changes", "Pages watched", "Last checked", "2026-09-24 02:09 UTC"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain(">—<");
    expect(html.toLowerCase()).not.toContain("no data");
    expect(html).not.toContain("Ads running");
  });

  it("draws a YouTube source as a degraded pill with the lost-channel reason", () => {
    const sources: RailSource[] = [
      {
        source: {
          key: "youtube.channel_rss",
          platform: "youtube",
          is_enabled: 1,
          config_json: "{}",
          watch_config_json: JSON.stringify({
            channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
            degraded: {
              state: "degraded",
              reason: LOST_CHANNEL_REASON,
              at: "2026-09-25T02:00:00.000Z",
            },
          }),
        },
        snapshot: null,
      },
    ];
    const html = frame({ rail: { ...quiet.rail, sources } });
    expect(html).toContain('data-state="degraded"');
    expect(html).toContain("finding the channel again");
    expect(html).not.toMatch(/>\s*Website\s*</);
  });

  it("falls back to the one-website line when no source has ever been stored", () => {
    const html = frame({ rail: { ...quiet.rail, sources: [] } });
    expect(html).toContain(">Website<");
    expect(html).toContain("Homepage, read every night");
  });

  it("draws a change as the mark with its before-and-after capture plate", () => {
    const html = frame({ changes: [change], weekCount: 1, biggestMove: move });
    expect(html).toContain("Kindred changed its homepage");
    expect(html).toContain("<s");
    expect(html).toContain("Plans from $10.");
    expect(html).toContain("<ins");
    expect(html).toContain("Plans from $12.");
    expect(html).toContain('aria-label="Open before and after: Kindred changed its homepage"');
    expect(html).toContain("/app/changes/sig-1/after?w=");
  });

  it("opens the latest WhyFlaggedSheet for a flagged change", () => {
    const html = frame({
      changes: [
        {
          ...change,
          whyFlagged: {
            verdictId: "v-9",
            compared: [],
            sure: "92%",
            decision: "Flagged",
            reason: null,
            decidedAt: "2026-09-20T10:00:00.000Z",
          },
        },
      ],
      weekCount: 1,
      biggestMove: move,
    });
    expect(html).toContain("Why we flagged this");
  });

  it("reads the quiet-week sentence in the biggest-move slab when nothing scored", () => {
    const html = frame();
    const slab = html.slice(html.indexOf('data-section="biggest-move"'), html.indexOf('data-section="developments"'));
    expect(slab).toContain(quiet.quiet);
  });

  it("does not open a WhyFlaggedSheet without a verdict", () => {
    expect(frame({ changes: [change], weekCount: 1, biggestMove: move })).not.toContain("Why we flagged this");
  });

  it("says when the first change can land, and freezes the feed at the pause", () => {
    expect(frame()).toContain(developmentsEmpty(null));
    expect(frame({ lastChecked: "2026-09-24 02:09 UTC" })).toContain(developmentsEmpty("2026-09-24 02:09 UTC"));
    expect(frame()).not.toContain('data-slot="feed-paused"');
    expect(frame({ pausedOn: "22 Sept" })).toContain("Paused 22 Sept.");
  });
});
