import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { BulkSelectBar } from "~/components/watchlists/bulk-select-bar";
import { CompetitorBand } from "~/components/watchlists/competitor-band";
import { WatchBoardTicker } from "~/components/watchlists/watch-board-ticker";
import { buildWatchBoardCaptureWindow } from "~/lib/watchlist-board.server";
import {
  buildWatchBoardTickerItems,
  formatWatchBandCadence,
  formatWatchBandMarket,
  formatWatchBoardCaughtValue,
  formatWatchBoardNextCheck,
  formatWatchBoardQuietValue,
  resolveWatchBandState,
  resolveWatchBoardStripAction,
  summarizeWatchBoard,
} from "~/lib/watchlist-display";

/**
 * BL-006 — the competitors watch board.
 * Brief §6.1 competitor band, §6.2 capture strip, §6.3 status strip inputs,
 * §7 board order. Every assertion here is about a claim the board makes:
 * a state it stamps, a number it reports, or a day it says it checked.
 */

function renderRouted(element: ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />);
}

const band = {
  captureDays: [{ date: "2026-07-26", state: "quiet" as const }],
  captureEndDate: "2026-07-27",
  captureWindowDays: 30,
  capturedChanges: 0,
  createdAt: "2026-07-13T00:00:00.000Z",
  id: "watch-1",
  isActive: true,
  isOpen: false,
  isPending: false,
  lastScannedAt: "2026-07-26T04:00:00.000Z",
  name: "Okara",
  plan: "starter",
  scanLabel: "Last successful check",
  scanTimestamp: "2026-07-26T04:00:00.000Z",
  selectable: false,
  selected: false,
  targetCountry: "IN",
  targetLabel: "okara.ai",
};

describe("watch band state (brief §6.1)", () => {
  it("reads state off stored evidence only", () => {
    expect(
      resolveWatchBandState({ isActive: false, lastScannedAt: "2026-07-26", capturedChanges: 4 }).label,
    ).toBe("Paused");
    expect(
      resolveWatchBandState({ isActive: true, lastScannedAt: "2026-07-26", capturedChanges: 2 }),
    ).toMatchObject({ label: "Caught", pillState: "caught" });
    expect(
      resolveWatchBandState({ isActive: true, lastScannedAt: null, capturedChanges: 0 }),
    ).toMatchObject({ label: "Watching", pillState: "watching" });
    // Quiet is a finding, not a gap (R2).
    expect(
      resolveWatchBandState({ isActive: true, lastScannedAt: "2026-07-26", capturedChanges: 0 }),
    ).toMatchObject({ label: "Quiet", pillState: "quiet" });
  });

  it("degrades the market line honestly instead of guessing a country", () => {
    expect(formatWatchBandMarket("IN")).toBe("India");
    expect(formatWatchBandMarket("India")).toBe("India");
    expect(formatWatchBandMarket("all")).toBe("Every market");
    expect(formatWatchBandMarket(null)).toBeNull();
    expect(formatWatchBandMarket("   ")).toBeNull();
  });

  it("states the cadence the plan actually delivers", () => {
    expect(formatWatchBandCadence({ isActive: true, plan: "free" })).toBe("Checked weekly");
    expect(formatWatchBandCadence({ isActive: true, plan: "agency" })).toBe(
      "Checked every 3–6 hours",
    );
    expect(formatWatchBandCadence({ isActive: false, plan: "agency" })).toBe(
      "Paused — no checks run",
    );
  });
});

describe("watch board summary (brief §6.3)", () => {
  const bands = [
    { id: "a", name: "Okara", isActive: true, lastScannedAt: "2026-07-27T04:00:00.000Z", capturedChanges: 3 },
    { id: "b", name: "Nykaa", isActive: true, lastScannedAt: "2026-07-26T04:00:00.000Z", capturedChanges: 0 },
    { id: "c", name: "Paused co", isActive: false, lastScannedAt: null, capturedChanges: 0 },
  ];

  it("counts competitors, captures and the newest completed check", () => {
    const summary = summarizeWatchBoard(bands);
    expect(summary).toMatchObject({
      competitors: 3,
      watching: 2,
      paused: 1,
      caught: 1,
      capturedChanges: 3,
      lastCheckAt: "2026-07-27T04:00:00.000Z",
    });
    expect(formatWatchBoardCaughtValue(summary, 30)).toBe("3 changes · 1 of 3 · 30d");
  });

  it("says nothing changed rather than printing a zero", () => {
    const quiet = summarizeWatchBoard([bands[1]]);
    expect(formatWatchBoardCaughtValue(quiet, 30)).toBeNull();
    expect(formatWatchBoardQuietValue(quiet, 30)).toBe("nothing changed in 30 days");
    const fresh = summarizeWatchBoard([{ ...bands[1], lastScannedAt: null }]);
    expect(formatWatchBoardQuietValue(fresh, 30)).toBe("no completed check yet");
    expect(formatWatchBoardQuietValue(summarizeWatchBoard([]), 30)).toBe("nothing tracked yet");
  });

  it("withholds a next check it cannot promise", () => {
    expect(
      formatWatchBoardNextCheck({ activeCompetitors: 2, sourceCanSchedule: true, nextScanLabel: "Mon 09:00" }),
    ).toBe("Mon 09:00");
    expect(
      formatWatchBoardNextCheck({ activeCompetitors: 2, sourceCanSchedule: false, nextScanLabel: "Mon 09:00" }),
    ).toBeNull();
    expect(
      formatWatchBoardNextCheck({ activeCompetitors: 0, sourceCanSchedule: true, nextScanLabel: "Mon 09:00" }),
    ).toBeNull();
  });

  it("points the single Rank-3 action at whatever is blocking the next check", () => {
    expect(resolveWatchBoardStripAction({ sourceCanSchedule: false, trackingStatusLabel: "Ready" })).toEqual({
      label: "Source access",
      to: "/app/source-access",
    });
    expect(
      resolveWatchBoardStripAction({ sourceCanSchedule: true, trackingStatusLabel: "Needs source access" }),
    ).toEqual({ label: "Source access", to: "/app/source-access" });
    expect(resolveWatchBoardStripAction({ sourceCanSchedule: true, trackingStatusLabel: "Ready" })).toEqual({
      label: "Alert delivery",
      to: "/app/notifications",
    });
  });

  it("builds ticker lines from stored facts only", () => {
    expect(buildWatchBoardTickerItems(bands, 30)).toEqual([
      "OKARA · 3 CHANGES CAUGHT · 30D",
      "NYKAA · QUIET · NOTHING CHANGED",
      "PAUSED CO · PAUSED",
    ]);
    expect(
      buildWatchBoardTickerItems([{ ...bands[1], lastScannedAt: null }], 30),
    ).toEqual(["NYKAA · FIRST CHECK RUNNING"]);
    expect(
      buildWatchBoardTickerItems([{ ...bands[0], capturedChanges: 1 }], 30),
    ).toEqual(["OKARA · 1 CHANGE CAUGHT · 30D"]);
  });
});

describe("capture window rollup (brief §6.2, §8.1)", () => {
  const now = new Date("2026-07-27T09:00:00.000Z");

  it("marks a day quiet only when a run completed, captured only when a change is stored", () => {
    const window = buildWatchBoardCaptureWindow({
      checkedRows: [
        { watchlist_id: "w1", day: "2026-07-25", hits: 1 },
        { watchlist_id: "w1", day: "2026-07-26", hits: 2 },
      ],
      capturedRows: [{ watchlist_id: "w1", day: "2026-07-26", hits: 2 }],
      now,
      windowDays: 30,
    });

    expect(window.endDate).toBe("2026-07-27");
    expect(window.days.w1).toEqual([
      { date: "2026-07-25", state: "quiet" },
      // A stored change outranks the run rollup for the same day.
      { date: "2026-07-26", state: "captured" },
    ]);
    expect(window.capturedChanges).toEqual({ w1: 2 });
    expect(window.totalCapturedChanges).toBe(2);
    // A day nobody reported is simply absent — the strip labels it unchecked.
    expect(window.days.w1.some((day) => day.date === "2026-07-27")).toBe(false);
  });

  it("drops rows outside the window and never invents a watchlist", () => {
    const window = buildWatchBoardCaptureWindow({
      checkedRows: [
        { watchlist_id: "w1", day: "2026-06-01", hits: 1 },
        { watchlist_id: "w1", day: null, hits: 1 },
      ],
      capturedRows: [{ watchlist_id: "w2", day: "2026-07-27", hits: 0 }],
      now,
      windowDays: 30,
    });

    expect(window.days).toEqual({});
    expect(window.totalCapturedChanges).toBe(0);
  });
});

describe("CompetitorBand (brief §6.1)", () => {
  it("renders one full-width band: stamp, name link, three meta lines, capture strip", () => {
    const markup = renderRouted(<CompetitorBand {...band} />);

    expect(markup).toContain("f9-ed-band");
    expect(markup).toContain("f9-ed-stamp is-quiet");
    expect(markup).toContain("Quiet");
    expect(markup).toContain('href="/app/watchlists?watchlist=watch-1"');
    expect(markup).toContain("Okara");
    expect(markup).toContain("Last successful check");
    expect(markup).toContain("Market · India");
    expect(markup).toContain("Checked every 3–6 hours");
    expect(markup).toContain("Watching since");
    expect(markup).toContain("f9-ed-capture-strip");
    // No checkbox rail, and no Vercel-era row classes.
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain("f9-work-row");
  });

  it("says the market is not recorded rather than dropping the row", () => {
    const markup = renderRouted(<CompetitorBand {...band} targetCountry={null} />);
    expect(markup).toContain("Market · not recorded");
    expect(markup).toContain("is-missing");
  });

  it("makes the state stamp the band-level select toggle, naming state and action", () => {
    const markup = renderRouted(
      <CompetitorBand {...band} onToggleSelect={vi.fn()} selectable selected />,
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Quiet — select Okara for bulk actions");
    expect(markup).toContain("Selected");
    expect(markup).toContain("f9-ed-band-select");
  });

  it("carries at most one Rank 2 and one Rank 3 in the action cell", () => {
    const markup = renderRouted(
      <CompetitorBand
        {...band}
        secondaryAction={{ label: "Package for client", to: "/app/reports/watchlist:watch-1" }}
        tertiaryAction={<button type="submit">Pause watching</button>}
      />,
    );

    expect(markup.match(/f9-ed-cta--rank2/g)).toHaveLength(1);
    expect(markup).toContain("Package for client");
    expect(markup).toContain("Pause watching");
    // A band never carries the screen's primary action.
    expect(markup).not.toContain("f9-ed-cta--rank1");
  });
});

describe("BulkSelectBar (brief §6.1)", () => {
  const noop = () => {};

  it("does not exist until something is selected", () => {
    const markup = renderToStaticMarkup(
      <BulkSelectBar
        onClear={noop}
        onPause={noop}
        onResume={noop}
        pending={false}
        pendingAction={null}
        selectedCount={0}
      />,
    );
    expect(markup).toBe("");
  });

  it("reads as counts, never as an instruction to select something", () => {
    const markup = renderToStaticMarkup(
      <BulkSelectBar
        onClear={noop}
        onPause={noop}
        onResume={noop}
        pending={false}
        pendingAction={null}
        selectedCount={2}
      />,
    );

    expect(markup).toContain("2 competitors selected");
    expect(markup).toContain("Pause 2");
    expect(markup).toContain("Resume 2");
    expect(markup).toContain("Clear selection");
    expect(markup).not.toContain("Select watchlists for bulk actions");
    expect(markup).not.toContain("f9-bulk-bar");
  });

  it("keeps the count singular for one competitor and shows the pending action", () => {
    const markup = renderToStaticMarkup(
      <BulkSelectBar
        onClear={noop}
        onPause={noop}
        onResume={noop}
        pending
        pendingAction="pause"
        selectedCount={1}
      />,
    );

    expect(markup).toContain("1 competitor selected");
    expect(markup).toContain("Pausing 1…");
  });
});

describe("WatchBoardTicker (brief §7, §9.7)", () => {
  it("renders one clipped belt of stored facts and nothing when there is none", () => {
    expect(renderToStaticMarkup(<WatchBoardTicker items={[]} />)).toBe("");

    const markup = renderToStaticMarkup(<WatchBoardTicker items={["OKARA · PAUSED"]} />);
    expect(markup).toContain("f9-ed-ticker");
    expect(markup).toContain('aria-hidden="true"');
    // Two runs make the loop seamless; the facts themselves are the bands.
    expect(markup.match(/f9-ed-ticker-run/g)).toHaveLength(2);
  });
});
