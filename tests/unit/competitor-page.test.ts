import { createElement, Fragment, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { CompetitorFrame } from "../../app/components/competitor-frame";
import {
  CompetitorHeader,
  competitorPausedLine,
  type CompetitorHeaderProps,
} from "../../app/components/competitor-header";

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

function header(props: CompetitorHeaderProps): string {
  return render(createElement(CompetitorHeader, props));
}

describe("the competitor page frame", () => {
  it("formats the paused line in en-GB UTC", () => {
    expect(competitorPausedLine("2026-09-22T12:00:00.000Z")).toBe("Paused 22 Sept");
    expect(competitorPausedLine(null)).toBe("Paused");
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
        createElement(CompetitorFrame),
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
      'data-section="verdict"',
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

  it("names every snapshot cell and never says no data", () => {
    const html = render(createElement(CompetitorFrame));
    for (const label of [
      "Ads running",
      "New ads",
      "Site changes",
      "Mentions",
      "Open roles",
      "Standing",
    ]) {
      expect(html).toContain(label);
    }
    expect(html.toLowerCase()).not.toContain("no data");
  });
});
