import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DAILY_DIGEST_CRON,
  DISCOVERY_WARMUP_CRON,
  REGULAR_MONITORING_CRON,
  STATUS_PROBES_CRON,
  WEEKLY_DIGEST_CRON,
  resolveScheduledTask,
} from "../workers/schedule";
import { RELEASE_SCHEDULE_CRONS } from "../app/lib/release-scheduled-observation-contract";
import { SCHEDULED_OBSERVATION_DEADLINES } from "../app/lib/scheduled-observation-health.server";

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
      // #3179/#3171: the scheduled presence digest rides the same 3-hourly
      // tick as the mention re-sweep; delivery is idempotent per workspace
      // per UTC day, so the 8 daily ticks send at most one digest each.
      includePresenceDigest: true,
      digestCadence: "weekly",
      digestLookbackDays: 7,
    });
    expect(resolveScheduledTask(DAILY_DIGEST_CRON)).toEqual({
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      includeMentionResweep: false,
      includeAutoCompetitorResweep: true,
      includePresenceDigest: false,
      digestCadence: "daily",
      digestLookbackDays: 1,
    });
    expect(resolveScheduledTask("0 5 * * MON-FRI")).toEqual({
      kind: "monitoring",
      includeScans: true,
      includeDigests: false,
      includeMentionResweep: true,
      includeAutoCompetitorResweep: false,
      includePresenceDigest: true,
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
      includePresenceDigest: false,
    });
  });

  it("pins the 5-minute status-probe cron to its own inert kind, outside the four-cron soak contract", () => {
    // The status-probe cron must be registered in wrangler and resolve to its
    // own kind: resolveScheduledTask's fallthrough for unrecognized crons is a
    // full monitoring tick, so an unpinned 5-minute cron would run the real
    // workload every five minutes.
    const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");
    expect(wranglerConfig).toContain(`"${STATUS_PROBES_CRON}"`);
    expect(resolveScheduledTask(STATUS_PROBES_CRON)).toEqual({ kind: "status_probes" });

    // Gap-check boundary (packet 2026-09-12): the deep-health gap check
    // accepts exactly the four workload crons. The probe cron is a
    // control-plane cron like the hourly gap check — it must neither be
    // flagged as a gap (not added to the deadline list) nor hide one (no
    // workload cron replaced). Its liveness evidence is the
    // status_probe_samples table's checked_at freshness, not the soak table.
    expect(SCHEDULED_OBSERVATION_DEADLINES.map(({ cron }) => cron)).toEqual([
      REGULAR_MONITORING_CRON,
      DISCOVERY_WARMUP_CRON,
      DAILY_DIGEST_CRON,
      WEEKLY_DIGEST_CRON,
    ]);
    expect(RELEASE_SCHEDULE_CRONS).not.toContain(STATUS_PROBES_CRON);
  });
});
