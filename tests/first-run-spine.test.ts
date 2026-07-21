import { describe, expect, it } from "vitest";

import {
  firstRunSpineNodeStatuses,
  firstRunSpineTrackFills,
  resolveFirstRunFurthest,
  shouldRenderFirstRunSpine,
  type FirstRunMilestone,
} from "~/components/first-run-spine";

describe("first-run spine — furthest derivation", () => {
  it("stays at 'add' for an empty workspace", () => {
    expect(
      resolveFirstRunFurthest({
        hasCompetitor: false,
        firstScanComplete: false,
        hasAnyBrief: false,
      }),
    ).toBe("add");
  });

  it("advances to 'scan' once a competitor is added (scan in flight)", () => {
    expect(
      resolveFirstRunFurthest({
        hasCompetitor: true,
        firstScanComplete: false,
        hasAnyBrief: false,
      }),
    ).toBe("scan");
  });

  it("advances to 'filing' once the scan completes but no brief has filed", () => {
    // A completed scan is NOT a brief: node 2 done, node 3 pending.
    expect(
      resolveFirstRunFurthest({
        hasCompetitor: true,
        firstScanComplete: true,
        hasAnyBrief: false,
      }),
    ).toBe("filing");
  });

  it("advances to 'brief' only once a real brief/digest record exists", () => {
    expect(
      resolveFirstRunFurthest({
        hasCompetitor: true,
        firstScanComplete: true,
        hasAnyBrief: true,
      }),
    ).toBe("brief");
  });

  it("never renders earlier than 'brief' once a brief exists, even without a competitor", () => {
    expect(
      resolveFirstRunFurthest({
        hasCompetitor: false,
        firstScanComplete: false,
        hasAnyBrief: true,
      }),
    ).toBe("brief");
  });

  it("retires the spine only once a brief has been filed — not on scan completion", () => {
    expect(shouldRenderFirstRunSpine({ hasAnyBrief: false })).toBe(true);
    expect(shouldRenderFirstRunSpine({ hasAnyBrief: true })).toBe(false);
  });
});

describe("first-run spine — node statuses are a pure function of furthest", () => {
  it.each<[FirstRunMilestone, ("done" | "now" | "idle")[]]>([
    ["add", ["now", "idle", "idle"]],
    ["scan", ["done", "now", "idle"]],
    ["filing", ["done", "done", "now"]],
    ["brief", ["done", "done", "done"]],
  ])("maps %s -> %j", (furthest, expected) => {
    expect(firstRunSpineNodeStatuses(furthest)).toEqual(expected);
  });

  it("is forward-only: no node after the current one is ever 'now' or 'done'", () => {
    for (const furthest of ["add", "scan", "filing", "brief"] as FirstRunMilestone[]) {
      const statuses = firstRunSpineNodeStatuses(furthest);
      const lastActive = statuses.reduce(
        (max, status, index) => (status !== "idle" ? index : max),
        -1,
      );
      statuses.forEach((status, index) => {
        if (index > lastActive) expect(status).toBe("idle");
      });
    }
  });
});

describe("first-run spine — connector fills", () => {
  it.each<[FirstRunMilestone, ("solid" | "gradient" | "idle")[]]>([
    ["add", ["idle", "idle"]],
    ["scan", ["gradient", "idle"]],
    ["filing", ["solid", "gradient"]],
    ["brief", ["solid", "solid"]],
  ])("maps %s -> %j", (furthest, expected) => {
    expect(firstRunSpineTrackFills(furthest)).toEqual(expected);
  });
});
