import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { BulkSelectBar } from "~/components/watchlists/bulk-select-bar";
import { buildWatchBoardCaptureWindow } from "~/lib/watchlist-board.server";
import {
  formatWatchBandCadence,
  resolveWatchBandState,
  WATCH_BAND_FAILURE_THRESHOLD,
} from "~/lib/watchlist-display";

/**
 * The claims the Competitors surface still makes about stored evidence.
 *
 * BL-006's board components (the band, the ticker, the five-cell status
 * strip) were deleted by BL-030 — the concept v4 pass replaced them with a
 * ruled list and a peek pane, and their specs went with them. What survives
 * here is what is still shipped: the band-state machine that names a
 * competitor's state, the plan-honest cadence line, the capture-window
 * rollup that feeds both, and the bulk-select bar.
 */

function renderRouted(element: ReactElement): string {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return renderToStaticMarkup(<Stub initialEntries={["/"]} />);
}

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

  /** BL-006 finding 5: the board must never stamp "Quiet" over broken scanning. */
  it("stamps Needs attention once checks keep failing, ahead of quiet and caught", () => {
    expect(WATCH_BAND_FAILURE_THRESHOLD).toBe(3);
    expect(
      resolveWatchBandState({
        isActive: true,
        lastScannedAt: "2026-07-26",
        capturedChanges: 0,
        failedChecks: 3,
      }),
    ).toMatchObject({ state: "attention", label: "Needs attention" });
    // A competitor that caught something last week but is failing now still
    // reads as broken, because the scanning is what stopped working.
    expect(
      resolveWatchBandState({
        isActive: true,
        lastScannedAt: "2026-07-26",
        capturedChanges: 4,
        failedChecks: 5,
      }).state,
    ).toBe("attention");
    // Two failures is not yet a pattern, and a paused watch is paused first.
    expect(
      resolveWatchBandState({
        isActive: true,
        lastScannedAt: "2026-07-26",
        capturedChanges: 0,
        failedChecks: 2,
      }).state,
    ).toBe("quiet");
    expect(
      resolveWatchBandState({
        isActive: false,
        lastScannedAt: "2026-07-26",
        capturedChanges: 0,
        failedChecks: 9,
      }).state,
    ).toBe("paused");
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

  it("counts hard failures since the last success and ignores soft cooldowns", () => {
    const window = buildWatchBoardCaptureWindow({
      checkedRows: [],
      capturedRows: [],
      // The query already excludes rate_limited / cache_only rows; the merge
      // must not invent an entry for a watchlist with zero hard failures.
      failedRows: [
        { watchlist_id: "w1", day: null, hits: 3 },
        { watchlist_id: "w2", day: null, hits: 0 },
      ],
      now,
      windowDays: 30,
    });

    expect(window.failedChecks).toEqual({ w1: 3 });
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
