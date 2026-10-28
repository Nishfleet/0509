import { describe, expect, it } from "vitest";

import { lostSources, mentionsHealth, skippedTargets } from "../../workers/mentions/health";
import type { MentionTarget, TargetOutcome } from "../../workers/mentions/sweep";

const ok: TargetOutcome = { items: 1, stored: 1, unjudged: 0, skipped: 0 };
const lost: TargetOutcome = { items: 0, stored: 0, unjudged: 0, skipped: 2 };

function target(pluginKey: string): MentionTarget {
  return { pluginKey, query: "q", sourceId: "src", minIntervalSeconds: 0, watches: [] };
}

describe("mentions run health", () => {
  it("counts a skipped target as lost even though the step did not throw", () => {
    expect(skippedTargets([ok, lost, lost, null])).toBe(2);
  });

  it("names every source that lost a target, once", () => {
    const targets = [target("gdelt.doc"), target("gdelt.doc"), target("hn.algolia"), target("youtube.channel_rss")];
    expect(lostSources(targets, [lost, lost, ok, null])).toEqual(["gdelt.doc", "youtube.channel_rss"]);
  });

  it("is ok when nothing was lost", () => {
    expect(mentionsHealth({ failed: 0, skippedTargets: 0, targets: 177, missed: [] })).toEqual({ state: "ok" });
  });

  it("is degraded, naming the source, for 44 skipped targets of 177 with none thrown", () => {
    expect(mentionsHealth({ failed: 0, skippedTargets: 44, targets: 177, missed: ["gdelt.doc"] })).toEqual({
      state: "degraded",
      reason: "44 skipped of 177: gdelt.doc",
    });
  });

  it("says how many failed and how many were skipped when both happened", () => {
    expect(mentionsHealth({ failed: 1, skippedTargets: 49, targets: 177, missed: ["gdelt.doc"] })).toEqual({
      state: "degraded",
      reason: "1 failed and 49 skipped of 177: gdelt.doc",
    });
  });

  it("is failed when half or more were lost", () => {
    expect(mentionsHealth({ failed: 10, skippedTargets: 80, targets: 177, missed: ["gdelt.doc"] })).toMatchObject({
      state: "failed",
    });
  });
});
