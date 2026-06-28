import { describe, expect, it } from "vitest";

import {
  evaluateAllowlistStep,
  evaluateFanoutConfigStep,
  evaluateFanoutLadderStep,
  evaluateFleet75Step,
  evaluateNightlyStep,
  evaluateShadowStep,
  formatFanoutLadderReport,
  parseWatchlistRunStatusCounts,
} from "../scripts/monitoring-fanout-canary.lib.mjs";

describe("monitoring fan-out canary ladder", () => {
  it("passes inline rollback config", () => {
    const result = evaluateFanoutConfigStep({
      mode: "inline",
      workflowBindingConfigured: true,
      internalWorkspaceConfigured: true,
      maxInflight: 8,
    });
    expect(result.ok).toBe(true);
    expect(result.blocker).toBeNull();
  });

  it("passes proven global fan-out production config", () => {
    const result = evaluateFanoutConfigStep({
      mode: "fanout",
      globalEnabled: true,
      workflowBindingConfigured: true,
      internalWorkspaceConfigured: true,
      maxInflight: 8,
    });
    expect(result.ok).toBe(true);
    expect(result.blocker).toBeNull();
  });

  it("flags wildcard allowlist as unsafe", () => {
    const result = evaluateFanoutConfigStep({
      mode: "fanout",
      allowlist: "*",
      workflowBindingConfigured: true,
      internalWorkspaceConfigured: true,
    });
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe("allowlist_wildcard_unsafe");
  });

  it("flags global enablement before pilot proof", () => {
    const result = evaluateFanoutConfigStep({
      mode: "fanout",
      globalEnabled: true,
      allowlist: "workspace-a",
      workflowBindingConfigured: true,
      internalWorkspaceConfigured: true,
    });
    expect(result.notes.some((note) => note.includes("MONITORING_FANOUT_GLOBAL=1"))).toBe(true);
  });

  it("validates shadow proof without durable runs", () => {
    expect(
      evaluateShadowStep({
        shadowOnly: 3,
        scheduledRunsCreated: 0,
        queued: 0,
      }).ok,
    ).toBe(true);
    expect(
      evaluateShadowStep({
        shadowOnly: 1,
        scheduledRunsCreated: 1,
      }).blocker,
    ).toBe("shadow_created_durable_runs");
  });

  it("validates one-watchlist allowlist pilot", () => {
    expect(
      evaluateAllowlistStep({
        queued: 1,
        dispatchFailures: 0,
        maxInflight: 1,
      }).ok,
    ).toBe(true);
    expect(
      evaluateAllowlistStep({
        queued: 2,
        dispatchFailures: 0,
      }).blocker,
    ).toBe("allowlist_not_single_job");
  });

  it("validates 75-job fleet proof thresholds", () => {
    expect(
      evaluateFleet75Step({
        queued: 75,
        dispatchFailures: 0,
        heldSlots: 8,
        maxInflight: 8,
      }).ok,
    ).toBe(true);
    expect(
      evaluateFleet75Step({
        queued: 75,
        dispatchFailures: 1,
      }).blocker,
    ).toBe("fleet75_dispatch_failures");
  });

  it("validates nightly drain expectations", () => {
    expect(
      evaluateNightlyStep({
        failed: 0,
        pending: 0,
        oldestQueuedAgeMs: null,
      }).ok,
    ).toBe(true);
    expect(
      evaluateNightlyStep({
        failed: 2,
        pending: 0,
      }).blocker,
    ).toBe("nightly_failed_runs");
  });

  it("routes unknown ladder steps to a blocker", () => {
    const result = evaluateFanoutLadderStep("bogus");
    expect(result.ok).toBe(false);
    expect(result.blocker).toBe("unknown_ladder_step");
  });

  it("formats human-readable reports", () => {
    const text = formatFanoutLadderReport(
      evaluateShadowStep({ shadowOnly: 1, scheduledRunsCreated: 0, queued: 0 }),
    );
    expect(text).toContain("shadow");
    expect(text).toContain("ok");
  });

  it("parses wrangler D1 status count JSON", () => {
    const metrics = parseWatchlistRunStatusCounts({
      result: [
        {
          results: [
            { status: "pending", count: 4 },
            { status: "succeeded", count: 71 },
          ],
        },
      ],
    });
    expect(metrics.pending).toBe(4);
    expect(metrics.succeeded).toBe(71);
    expect(metrics.scheduledRunsCreated).toBe(75);
  });
});
