import { describe, expect, it } from "vitest";

import {
  buildCaptureWindow,
  trailingQuietRun,
  type CaptureDay,
} from "~/components/evidence/capture-strip";

/** BL-005 — brief §6.2: 30 days, right-aligned, gaps labelled not hidden. */

function quietDays(count: number, from = "2026-06-28"): CaptureDay[] {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    state: "quiet" as const,
  }));
}

describe("buildCaptureWindow", () => {
  it("expands a sparse list into a full right-aligned window", () => {
    const window = buildCaptureWindow(
      [
        { date: "2026-07-27", state: "captured" },
        { date: "2026-07-26", state: "quiet" },
      ],
      { windowDays: 5 },
    );

    expect(window).toHaveLength(5);
    expect(window.at(-1)).toEqual({ date: "2026-07-27", state: "captured" });
    expect(window.at(-2)).toEqual({ date: "2026-07-26", state: "quiet" });
  });

  it("marks a day we never checked as an explicit unchecked slot", () => {
    const window = buildCaptureWindow([{ date: "2026-07-27", state: "captured" }], {
      windowDays: 3,
    });

    expect(window.map((day) => day.state)).toEqual(["unchecked", "unchecked", "captured"]);
  });

  it("returns nothing rather than guessing a window with no dates at all", () => {
    expect(buildCaptureWindow([], {})).toEqual([]);
    expect(buildCaptureWindow([{ date: "not-a-date", state: "quiet" }], {})).toEqual([]);
  });

  it("keeps a stored day even when it predates the recorded start", () => {
    const window = buildCaptureWindow([{ date: "2026-07-20", state: "captured" }], {
      endDate: "2026-07-27",
      startDate: "2026-07-25",
      windowDays: 8,
    });

    expect(window.find((day) => day.date === "2026-07-20")?.state).toBe("captured");
    expect(window.find((day) => day.date === "2026-07-21")?.state).toBe("prewatch");
  });
});

describe("trailingQuietRun", () => {
  it("counts back to the last captured change", () => {
    const window = buildCaptureWindow(
      [...quietDays(9, "2026-07-19"), { date: "2026-07-18", state: "captured" }],
      { windowDays: 12 },
    );
    expect(trailingQuietRun(window)).toBe(9);
  });

  it("stops at an unchecked day instead of claiming continuous coverage", () => {
    const window = buildCaptureWindow(quietDays(3, "2026-07-25"), { windowDays: 8 });
    expect(trailingQuietRun(window)).toBe(3);
  });

  /**
   * BL-006 decision (BL-005 known defect 4). Position decides meaning: the
   * newest slot is unchecked for most of every day simply because that day's
   * scan has not run yet, while a hole between two checked days is missing
   * evidence we must not paper over.
   */
  it("skips a leading unchecked day — today before its scan is 'not yet', not a gap", () => {
    const window = buildCaptureWindow(quietDays(5, "2026-07-22"), {
      endDate: "2026-07-27",
      windowDays: 8,
    });

    expect(window.at(-1)).toEqual({ date: "2026-07-27", state: "unchecked" });
    expect(trailingQuietRun(window)).toBe(5);
  });

  /**
   * BL-006 blocking finding 3: the leading skip is capped at ONE slot, so a
   * paused competitor or a source outage can never print "nothing has
   * changed" over a watch that stopped watching.
   */
  it("stops rather than skipping a second unchecked day at the leading edge", () => {
    const window = buildCaptureWindow(quietDays(5, "2026-07-20"), {
      endDate: "2026-07-27",
      windowDays: 10,
    });

    // 20-24 quiet, then 25/26/27 unchecked: three days with no check at all.
    expect(window.slice(-3).every((day) => day.state === "unchecked")).toBe(true);
    expect(trailingQuietRun(window)).toBe(0);
  });

  it("ends the run at the prewatch void instead of counting past it", () => {
    const window = buildCaptureWindow(quietDays(3, "2026-07-25"), {
      endDate: "2026-07-27",
      startDate: "2026-07-25",
      windowDays: 10,
    });

    expect(trailingQuietRun(window)).toBe(3);
  });

  it("still stops at an unchecked day inside the run", () => {
    const window = buildCaptureWindow(
      [...quietDays(2, "2026-07-26"), ...quietDays(2, "2026-07-22")],
      { endDate: "2026-07-27", windowDays: 8 },
    );

    expect(trailingQuietRun(window)).toBe(2);
  });
});
