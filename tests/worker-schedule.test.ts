import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DAILY_MONITORING_CRON,
  DISCOVERY_WARMUP_CRON,
  WEEKLY_DIGEST_CRON,
  resolveScheduledTask,
} from "../workers/schedule";

describe("worker schedule", () => {
  it("keeps discovery warmup on a bounded six-hour cadence", () => {
    const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");

    expect(wranglerConfig).toContain(`"${DISCOVERY_WARMUP_CRON}"`);
    expect(wranglerConfig).not.toContain('"*/30 * * * *"');
  });

  it("routes only the exact weekly cron through digest generation", () => {
    expect(resolveScheduledTask(DISCOVERY_WARMUP_CRON)).toEqual({
      kind: "discovery_warmup",
    });
    expect(resolveScheduledTask(DAILY_MONITORING_CRON)).toEqual({
      kind: "monitoring",
      includeScans: true,
      includeDigests: true,
      digestCadence: "daily",
      digestLookbackDays: 1,
    });
    expect(resolveScheduledTask("0 5 * * MON-FRI")).toEqual({
      kind: "monitoring",
      includeScans: true,
      includeDigests: false,
      digestCadence: "weekly",
      digestLookbackDays: 7,
    });
  });

  it("keeps the Monday weekly cron digest-only so it cannot double-scan after the daily run", () => {
    expect(resolveScheduledTask(WEEKLY_DIGEST_CRON)).toEqual({
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      digestCadence: "weekly",
      digestLookbackDays: 7,
    });
  });
});
