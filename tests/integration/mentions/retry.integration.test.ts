import { describe, expect, it } from "vitest";

import type { SweepPass } from "../../../workers/mentions/retry";
import { deferred, retrySkipped, sustainedSkips, track, tripped } from "../../../workers/mentions/retry";
import type { MentionTarget, TargetOutcome } from "../../../workers/mentions/sweep";

const ok: TargetOutcome = { items: 1, stored: 1, unjudged: 0, skipped: 0 };
const lost: TargetOutcome = { items: 0, stored: 0, unjudged: 0, skipped: 1 };

function target(query: string): MentionTarget {
  return { pluginKey: "gdelt.doc", query, sourceId: "src", minIntervalSeconds: 6, watches: [] } as never;
}

function pass(outcomes: TargetOutcome[], stillLost: readonly string[] = []) {
  const calls: string[] = [];
  const sleeps: string[] = [];
  const step = {
    sleep: (name: string) => Promise.resolve(void sleeps.push(name)),
    do: <T>(_name: string, _config: unknown, run: () => Promise<T>) => run(),
  };
  const sweepPass: SweepPass = {
    targets: outcomes.map((_outcome, index) => target(`q${String(index)}`)),
    outcomes,
    run: (item) => {
      calls.push(item.query);
      return Promise.resolve(stillLost.includes(item.query) ? lost : ok);
    },
  };
  return { step, sweepPass, calls, sleeps };
}

describe("mentions retry of skipped targets", () => {
  it("runs nothing and never sleeps when no target was skipped", async () => {
    const { step, sweepPass, calls, sleeps } = pass([ok, ok]);
    expect(await retrySkipped(step as never, sweepPass)).toEqual([ok, ok]);
    expect([calls, sleeps]).toEqual([[], []]);
  });

  it("retries only the skipped targets, up to three rounds, and keeps the recovered outcome", async () => {
    const { step, sweepPass, calls, sleeps } = pass([ok, lost, lost], ["q2"]);
    const result = await retrySkipped(step as never, sweepPass);
    expect(calls).toEqual(["q1", "q2", "q2", "q2"]);
    expect(sleeps[0]).toBe("pause before retry round 0");
    expect(result.map((outcome) => outcome?.skipped)).toEqual([0, 0, 1]);
  });

  it("reports a source when at least three targets and half of them stay skipped", () => {
    expect(sustainedSkips(pass([lost, lost, lost, ok]).sweepPass)).toEqual([
      { pluginKey: "gdelt.doc", skipped: 3, total: 4 },
    ]);
  });

  it("stays quiet for a couple of skips or a small share", () => {
    expect(sustainedSkips(pass([lost, lost, ok, ok]).sweepPass)).toEqual([]);
    expect(sustainedSkips(pass([lost, lost, lost, ok, ok, ok, ok, ok]).sweepPass)).toEqual([]);
  });

  it("trips a source after three skipped targets in a row and resets on a success", () => {
    const streaks = new Map<string, number>();
    const first = target("a");
    track(streaks, first, lost);
    track(streaks, first, lost);
    expect(tripped(streaks, first)).toBe(false);
    track(streaks, first, lost);
    expect(tripped(streaks, first)).toBe(true);
    track(streaks, first, ok);
    expect(tripped(streaks, first)).toBe(false);
  });

  it("counts a deferred target's watches as skipped", () => {
    const withWatches = { ...target("a"), watches: [1, 2, 3] } as never as MentionTarget;
    expect(deferred(withWatches).skipped).toBe(3);
  });
});
