import { readFileSync } from "node:fs";

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

  it("still stops at an unchecked day inside the run", () => {
    const window = buildCaptureWindow(
      [...quietDays(2, "2026-07-26"), ...quietDays(2, "2026-07-22")],
      { endDate: "2026-07-27", windowDays: 8 },
    );

    expect(trailingQuietRun(window)).toBe(2);
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

describe("capture bar silhouette (brief §6.2, §8.1)", () => {
  const css = readFileSync("app/app.css", "utf8");

  function barHeight(state: string): number {
    const marker = `.f9-ed-capture-bar.is-${state} {`;
    const start = css.indexOf(marker);
    expect(start, `${marker} should exist`).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    const match = block.match(/height:\s*(\d+(?:\.\d+)?)px/);
    expect(match, `is-${state} should declare a height`).not.toBeNull();
    return Number(match![1]);
  }

  it("keeps height monotonic: tall means a change, short means no change", () => {
    const quiet = barHeight("quiet");
    const captured = barHeight("captured");
    const waiting = barHeight("waiting");
    const unchecked = barHeight("unchecked");

    expect(captured).toBeGreaterThan(quiet);
    expect(waiting).toBe(captured);
    // The load-bearing assertion: an outage must never wear the silhouette
    // of a caught change. A day we did not check reads as "no change plus no
    // data", so it stays short and says the rest with a dashed edge.
    expect(unchecked).not.toBe(captured);
    expect(unchecked).toBeLessThan(captured);
    expect(unchecked).toBe(quiet);
  });

  it("distinguishes an unchecked day from a quiet day without using height", () => {
    const start = css.indexOf(".f9-ed-capture-bar.is-unchecked {");
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("border: 1px dashed var(--ed-rule-dashed);");
    expect(block).toContain("background: none;");

    const quietStart = css.indexOf(".f9-ed-capture-bar.is-quiet {");
    const quietBlock = css.slice(quietStart, css.indexOf("}", quietStart));
    expect(quietBlock).toContain("background: var(--ed-bar-quiet);");
    expect(quietBlock).not.toContain("dashed");
  });
});
