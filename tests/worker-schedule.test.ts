import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DAILY_DIGEST_CRON,
  DAILY_MONITORING_CRON,
  DISCOVERY_WARMUP_CRON,
  REGULAR_MONITORING_CRON,
  WEEKLY_DIGEST_CRON,
  resolveOperationalRiskAlertIdempotencyKey,
  resolveScheduledTask,
} from "../workers/schedule";

describe("worker schedule", () => {
  it("keeps discovery warmup on a bounded six-hour cadence", () => {
    const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");

    expect(wranglerConfig).toContain(`"${DISCOVERY_WARMUP_CRON}"`);
    expect(wranglerConfig).toContain(`"${REGULAR_MONITORING_CRON}"`);
    expect(wranglerConfig).not.toContain('"*/30 * * * *"');
  });

  it("routes regular scans separately from daily digest generation", () => {
    expect(resolveScheduledTask(DISCOVERY_WARMUP_CRON)).toEqual({
      kind: "discovery_warmup",
    });
    expect(resolveScheduledTask(REGULAR_MONITORING_CRON)).toEqual({
      kind: "monitoring",
      includeScans: true,
      includeDigests: false,
      includeMentionResweep: true,
      includeRiskAlert: false,
    });
    expect(resolveScheduledTask(DAILY_DIGEST_CRON)).toEqual({
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      includeMentionResweep: false,
      includeRiskAlert: true,
      digestCadence: "daily",
      digestLookbackDays: 1,
    });
    expect(resolveScheduledTask(DAILY_MONITORING_CRON)).toEqual(resolveScheduledTask(DAILY_DIGEST_CRON));
    expect(resolveScheduledTask("0 5 * * MON-FRI")).toEqual({
      kind: "monitoring",
      includeScans: true,
      includeDigests: false,
      includeMentionResweep: true,
      includeRiskAlert: false,
    });
  });

  it("keeps the Monday weekly cron digest-only so it cannot double-scan after the daily run", () => {
    expect(resolveScheduledTask(WEEKLY_DIGEST_CRON)).toEqual({
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      includeMentionResweep: false,
      includeRiskAlert: false,
      digestCadence: "weekly",
      digestLookbackDays: 7,
    });
  });

  it("keeps operational risk alert idempotency distinct by failure type", () => {
    expect(resolveOperationalRiskAlertIdempotencyKey("2026-07-03", {
      skippedForBudget: 2,
      dispatchFailures: 0,
    })).toBe("operator-alert:scan-budget:2026-07-03");
    expect(resolveOperationalRiskAlertIdempotencyKey("2026-07-03", {
      skippedForBudget: 0,
      dispatchFailures: 1,
    })).toBe("operator-alert:fanout-dispatch:2026-07-03");
    expect(resolveOperationalRiskAlertIdempotencyKey("2026-07-03", {
      skippedForBudget: 2,
      dispatchFailures: 1,
    })).toBe("operator-alert:scan-budget-and-fanout-dispatch:2026-07-03");
    expect(resolveOperationalRiskAlertIdempotencyKey("2026-07-03", {
      skippedForBudget: 0,
      dispatchFailures: 0,
    })).toBeNull();
    expect(resolveOperationalRiskAlertIdempotencyKey("2026-07-03", {
      skippedForBudget: 0,
      dispatchFailures: 0,
      inlineFailures: 1,
      digestFailures: 0,
    })).toBe("operator-alert:scheduled-degraded-inline:2026-07-03");
    expect(resolveOperationalRiskAlertIdempotencyKey("2026-07-03", {
      skippedForBudget: 0,
      dispatchFailures: 0,
      inlineFailures: 0,
      digestFailures: 1,
    })).toBe("operator-alert:scheduled-degraded-digest:2026-07-03");
    expect(resolveOperationalRiskAlertIdempotencyKey("2026-07-03", {
      skippedForBudget: 0,
      dispatchFailures: 0,
      inlineFailures: 1,
      digestFailures: 1,
    })).toBe("operator-alert:scheduled-degraded-inline-and-digest:2026-07-03");
    expect(resolveOperationalRiskAlertIdempotencyKey("2026-07-03", {
      skippedForBudget: 2,
      dispatchFailures: 1,
      inlineFailures: 1,
      digestFailures: 1,
    })).toBe(
      "operator-alert:scheduled-degraded-scan-budget-and-fanout-dispatch-and-inline-and-digest:2026-07-03",
    );
  });
});
