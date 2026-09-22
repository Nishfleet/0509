import { describe, expect, it } from "vitest";

import { isPolled, queueFor, readSourceConfig, sourcePill, splitMessages } from "../../workers/mentions/map";

const X_CONFIG =
  '{"rateClass":"paced","canaryUrl":"","expectNonzero":true,"approved_cost":null,"quotedCost":"Apify about $0.40 per 1,000 tweets","disabledReason":"Every zero-spend X route is closed. approved_cost stays null until Nish says yes."}';

describe("disabled X source", () => {
  it("stays out of the poll, the queue, and the pills", () => {
    const config = readSourceConfig(X_CONFIG);
    expect(config.approved_cost).toBeNull();
    expect(config.quotedCost).toContain("0.40");
    expect(isPolled({ entityState: "on", kind: "mentions", isEnabled: 0 })).toBe(false);
    expect(sourcePill({
      pluginKey: "x.apify",
      label: "X",
      isEnabled: false,
      degradedSince: "2026-09-22T00:00:00.000Z",
      degradedReason: config.disabledReason ?? null,
      lastGoodAt: null,
      lastSnapshotAt: null,
    })).toBeNull();
  });

  it("produces a paced queue message once the row is enabled", () => {
    expect(isPolled({ entityState: "on", kind: "mentions", isEnabled: 1 })).toBe(true);
    expect(queueFor({ pluginKey: "x.apify", reliability: "best_effort", rateClass: "paced" })).toBe("paced");
    const split = splitMessages([
      {
        watchId: "watch-x",
        sourceId: "src_x_apify",
        entityId: "entity-1",
        workspaceId: "ws-1",
        pluginKey: "x.apify",
        reliability: "best_effort",
        rateClass: "paced",
      },
    ]);
    expect(split.fast).toEqual([]);
    expect(split.paced).toEqual([
      { watchId: "watch-x", sourceId: "src_x_apify", entityId: "entity-1", workspaceId: "ws-1" },
    ]);
  });
});
