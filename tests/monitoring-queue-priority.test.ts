import { beforeEach, describe, expect, it } from "vitest";

import {
  computeEffectiveQueuePriority,
  compareQueuedRuns,
  MONITORING_QUEUE_AGING_INTERVAL_MS,
} from "~/lib/monitoring-fanout.server";

describe("monitoring queue priority", () => {
  it("ranks agency ahead of starter and scout at equal age", () => {
    const now = Date.parse("2026-06-24T04:00:00.000Z");
    const agency = {
      id: "a",
      watchlist_id: "w1",
      queue_priority: 0,
      queued_at: "2026-06-24T03:00:00.000Z",
      started_at: "2026-06-24T03:00:00.000Z",
      user_id: "u1",
      plan: "agency",
      effectivePriority: computeEffectiveQueuePriority(0, "2026-06-24T03:00:00.000Z", now),
    };
    const starter = {
      ...agency,
      id: "s",
      queue_priority: 1,
      effectivePriority: computeEffectiveQueuePriority(1, "2026-06-24T03:00:00.000Z", now),
      plan: "starter",
    };
    expect(compareQueuedRuns(agency, starter)).toBeLessThan(0);
  });

  it("ages lower-priority runs after the configured interval", () => {
    const queuedAt = "2026-06-24T00:00:00.000Z";
    const beforeBoost = computeEffectiveQueuePriority(
      2,
      queuedAt,
      Date.parse(queuedAt) + MONITORING_QUEUE_AGING_INTERVAL_MS - 1,
    );
    const afterBoost = computeEffectiveQueuePriority(
      2,
      queuedAt,
      Date.parse(queuedAt) + MONITORING_QUEUE_AGING_INTERVAL_MS,
    );
    expect(beforeBoost).toBe(2);
    expect(afterBoost).toBe(1);
  });
});
