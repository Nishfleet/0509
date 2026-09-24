import { createElement, Fragment, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { CompetitorFrame, type CompetitorFrameProps, developmentsEmpty } from "../../app/components/competitor-frame";
import { COMPETITOR_REASON_LINES, competitorReasonFragment } from "../../app/lib/competitor-reason";
import type { SiteChangeItemData } from "../../app/components/site-change-item";
import {
  CompetitorHeader,
  CompetitorSwitch,
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
  sentence: "3 words added, 2 removed.",
  mark: { removed: "Plans from $10.", added: "Plans from $12." },
  before: { src: "/app/changes/sig-1/before", capturedAt: "2026-09-23 02:09 UTC" },
  after: { src: "/app/changes/sig-1/after", capturedAt: "2026-09-24 02:09 UTC" },
  when: "today",
};

const quiet: CompetitorFrameProps = {
  changes: [],
  weekCount: 0,
  biggestId: null,
  pages: 0,
  lastChecked: null,
  pausedOn: null,
};

function frame(props: Partial<CompetitorFrameProps> = {}): string {
  return render(createElement(CompetitorFrame, { ...quiet, ...props }));
}

function header(props: CompetitorHeaderProps): string {
  return render(createElement(CompetitorHeader, props));
}

describe("the competitor page frame", () => {
  it("formats the paused line in en-GB UTC", () => {
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z")).toBe("Paused 22 Sept");
    expect(competitorPausedLine(null)).toBe("Paused");
  });

  it("reads state_reason in customer words from the canonical map and never shows a code", () => {
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z", "acquired")).toBe(
      `Paused 22 Sept · ${competitorReasonFragment("acquired")}`,
    );
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z", "shut_down")).toBe(
      `Paused 22 Sept · ${competitorReasonFragment("shut_down")}`,
    );
    expect(competitorReasonFragment("acquired")).toBe("looks like it was acquired");
    expect(competitorReasonFragment("shut_down")).toBe("looks like it shut down");
    expect(COMPETITOR_REASON_LINES.acquired).toBe("Looks like it was acquired");
    expect(COMPETITOR_REASON_LINES.shut_down).toBe("Looks like it shut down");
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z", "some_code")).toBe("Paused 22 Sept");

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
        createElement(CompetitorFrame, { ...quiet, changes: [change], weekCount: 1, biggestId: "sig-1" }),
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
      'data-section="sources"',
    ];
    let at = -1;
    for (const marker of markers) {
      const index = html.indexOf(marker);
      expect(index).toBeGreaterThan(at);
      at = index;
    }
  });

  it("prints the DESIGN.md 2.5 consequence beside the switch in both states, never a dialog", () => {
    for (const state of ["on", "off"] as const) {
      const html = render(createElement(CompetitorSwitch, { state, brandName: "Kindred" }));
      expect(html).toContain('data-slot="competitor-switch"');
      expect(html).toContain('role="switch"');
      expect(html).toContain(
        "Off stops the watching and the alerts. The history stays, and turning it back on picks up where it left off.",
      );
      expect(html).not.toContain('role="dialog"');
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

  it("draws a change as the mark with its before-and-after capture plate", () => {
    const html = frame({ changes: [change], weekCount: 1, biggestId: "sig-1" });
    expect(html).toContain("Kindred changed its homepage");
    expect(html).toContain("<s");
    expect(html).toContain("Plans from $10.");
    expect(html).toContain("<ins");
    expect(html).toContain("Plans from $12.");
    expect(html).toContain('aria-label="Open before and after: Kindred changed its homepage"');
    expect(html).toContain("/app/changes/sig-1/after?w=");
  });

  it("says when the first change can land, and freezes the feed at the pause", () => {
    expect(frame()).toContain(developmentsEmpty(null));
    expect(frame({ lastChecked: "2026-09-24 02:09 UTC" })).toContain(developmentsEmpty("2026-09-24 02:09 UTC"));
    expect(frame()).not.toContain('data-slot="feed-paused"');
    expect(frame({ pausedOn: "22 Sept" })).toContain("Paused 22 Sept.");
  });
});
