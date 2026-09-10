import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DAILY_DIGEST_CRON,
  DISCOVERY_WARMUP_CRON,
  REGULAR_MONITORING_CRON,
  WEEKLY_DIGEST_CRON,
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
    // The three-hourly tick hosts the weekly brief: each workspace's digest
    // job is enqueued only while its local time is inside the Monday
    // 05:00-08:00 window (issue #2406).
    expect(resolveScheduledTask(REGULAR_MONITORING_CRON)).toEqual({
      kind: "monitoring",
      includeScans: true,
      includeDigests: true,
      includeMentionResweep: true,
      includeAutoCompetitorResweep: false,
      digestCadence: "weekly",
      digestLookbackDays: 7,
    });
    expect(resolveScheduledTask(DAILY_DIGEST_CRON)).toEqual({
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      includeMentionResweep: false,
      includeAutoCompetitorResweep: true,
      digestCadence: "daily",
      digestLookbackDays: 1,
    });
    expect(resolveScheduledTask("0 5 * * MON-FRI")).toEqual({
      kind: "monitoring",
      includeScans: true,
      includeDigests: false,
      includeMentionResweep: true,
      includeAutoCompetitorResweep: false,
    });
  });

  it("keeps the Monday cron free of digests now that the three-hourly tick hosts the per-workspace window", () => {
    // Issue #2406: one 05:00 UTC Monday shot landed Sunday evening in the
    // Americas. The Monday cron still exists (weekly business numbers and
    // monthly recaps key on the cron string in workers/app.ts) but resolves
    // to a scan-free, digest-free monitoring tick; the weekly cycle rides
    // the three-hourly cron so each workspace files at local Monday morning.
    expect(resolveScheduledTask(WEEKLY_DIGEST_CRON)).toEqual({
      kind: "monitoring",
      includeScans: false,
      includeDigests: false,
      includeMentionResweep: false,
      includeAutoCompetitorResweep: false,
    });
  });
});
