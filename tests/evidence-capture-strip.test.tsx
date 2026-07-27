import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CAPTURE_STRIP_GAP_LEGEND,
  CAPTURE_STRIP_LEGEND,
  CaptureStrip,
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
        { date: "2026-07-27", state: "waiting" },
        { date: "2026-07-26", state: "quiet" },
      ],
      { windowDays: 5 },
    );

    expect(window).toHaveLength(5);
    expect(window.at(-1)).toEqual({ date: "2026-07-27", state: "waiting" });
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
});

describe("CaptureStrip", () => {
  it("labels a gap in the row instead of dropping the day silently", () => {
    const markup = renderToStaticMarkup(
      <CaptureStrip
        days={[
          { date: "2026-07-27", state: "waiting" },
          { date: "2026-07-25", state: "quiet" },
        ]}
        windowDays={4}
      />,
    );

    expect(markup.match(/is-unchecked/g)).toHaveLength(2);
    expect(markup).toContain("we did not check that day");
    expect(markup).toContain(CAPTURE_STRIP_GAP_LEGEND);
  });

  it("names every bar in words so colour is never the only channel", () => {
    const markup = renderToStaticMarkup(
      <CaptureStrip days={[{ date: "2026-07-27", state: "captured" }]} windowDays={1} />,
    );

    expect(markup).toContain(CAPTURE_STRIP_LEGEND);
    expect(markup).toContain("a change we captured");
    expect(markup).toContain('data-capture-state="captured"');
  });

  it("states a long quiet run as a finding, not as a gap", () => {
    const markup = renderToStaticMarkup(
      <CaptureStrip days={quietDays(26, "2026-07-02")} windowDays={26} />,
    );

    expect(markup).toContain("Nothing has changed here in 26 days. That is a finding, not a gap.");
  });

  it("stays quiet about short runs and drops the gap sentence when there are no gaps", () => {
    const markup = renderToStaticMarkup(
      <CaptureStrip days={quietDays(4, "2026-07-24")} windowDays={4} />,
    );

    expect(markup).not.toContain("That is a finding");
    expect(markup).not.toContain(CAPTURE_STRIP_GAP_LEGEND);
  });

  it("renders nothing when there is no window to draw", () => {
    expect(renderToStaticMarkup(<CaptureStrip days={[]} />)).toBe("");
  });
});
