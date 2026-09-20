import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DAILY_DIGEST_CRON,
  DISCOVERY_WARMUP_CRON,
  REGULAR_MONITORING_CRON,
  STATUS_PROBE_CRON_PROBES,
  STATUS_PROBES_CRON,
  WEEKLY_DIGEST_CRON,
  resolveScheduledTask,
} from "../workers/schedule";
import { STATUS_PROBE_NAMES } from "~/lib/status-probes.server";
import { RELEASE_SCHEDULE_CRONS } from "../app/lib/release-scheduled-observation-contract";
import { SCHEDULED_OBSERVATION_DEADLINES } from "../app/lib/scheduled-observation-health.server";

describe("worker schedule", () => {
  it("keeps discovery warmup on a bounded six-hour cadence", () => {
    const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");

    expect(wranglerConfig).toContain(`"${DISCOVERY_WARMUP_CRON}"`);
    expect(wranglerConfig).toContain(`"${REGULAR_MONITORING_CRON}"`);
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

  it("gives each status-probe cadence its own Cron Trigger with an exact probe set (issue #3782)", () => {
    // One trigger per cadence, each pinned to the probes it may run — no
    // in-code tick arithmetic. Every probe cron must be registered in
    // wrangler AND resolve to its own kind: resolveScheduledTask's
    // fallthrough for unrecognized crons is a full monitoring tick, so an
    // unpinned probe cron would run the real workload on a probe cadence.
    const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");
    const expected: Record<string, string[]> = {
      [STATUS_PROBES_CRON]: ["public_search", "billing_dodo", "uptime"],
      "*/15 * * * *": ["email_delivery"],
      "*/30 * * * *": ["signin_dispatch"],
      "25 * * * *": ["provider_meta"],
    };
    expect(Object.keys(STATUS_PROBE_CRON_PROBES).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [cron, probes] of Object.entries(expected)) {
      expect(wranglerConfig).toContain(`"${cron}"`);
      expect(resolveScheduledTask(cron)).toEqual({ kind: "status_probes", probes });
    }
    // The trigger table must cover every probe exactly once — a probe absent
    // from every row silently never runs, and a probe on two rows double-fires.
    const scheduled = Object.values(STATUS_PROBE_CRON_PROBES).flat();
    expect([...scheduled].sort()).toEqual([...STATUS_PROBE_NAMES].sort());
  });

  it("pins the status-probe crons outside the four-cron soak contract", () => {
    // Gap-check boundary (packet 2026-09-12): the deep-health gap check
    // accepts exactly the four workload crons. The probe crons are
    // control-plane crons like the hourly gap check — they must neither be
    // flagged as a gap (not added to the deadline list) nor hide one (no
    // workload cron replaced). Their liveness evidence is the
    // status_probe_samples table's checked_at freshness, not the soak table.
    expect(SCHEDULED_OBSERVATION_DEADLINES.map(({ cron }) => cron)).toEqual([
      REGULAR_MONITORING_CRON,
      DISCOVERY_WARMUP_CRON,
      DAILY_DIGEST_CRON,
      WEEKLY_DIGEST_CRON,
    ]);
    for (const cron of Object.keys(STATUS_PROBE_CRON_PROBES)) {
      expect(RELEASE_SCHEDULE_CRONS).not.toContain(cron);
    }
  });
});
