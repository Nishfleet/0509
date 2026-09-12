import { describe, expect, it } from "vitest";

import { recordStatusHealthSample, readStatusUptime } from "~/lib/scheduled-observation-health.server";
import { getPublicStatusSurfaces } from "~/lib/public-status-counters.server";

import { appEnv, db } from "./fixtures";

/**
 * /status measured surfaces against the REAL migrated D1 (the workers project
 * applies the full migration chain, 0097 included). Three truths, no mocks:
 *   1. WRITE: recordStatusHealthSample inserts a real sample row (and prunes
 *      past 7 days) on the migrated table's CHECK/shape;
 *   2. READ: readStatusUptime sees the written sample in its 24h window;
 *   3. getPublicStatusSurfaces assembles measured rows (never throws, never
 *      uses the banned confession vocabulary) from real tables.
 *
 * The plugin isolates local storage per test FILE, so seeded ids are unique
 * within this file and assertions scope themselves.
 */

describe("status health sample — real migrated D1", () => {
  it("writes a sample with a passing D1 probe and reads it back in the 24h window", async () => {
    const before = await readStatusUptime(appEnv);
    const wrote = await recordStatusHealthSample(appEnv, "13 * * * *");
    expect(wrote).toBe(true);

    const after = await readStatusUptime(appEnv);
    expect(after.samples24h).toBe(before.samples24h + 1);
    expect(after.okSamples24h).toBe(before.okSamples24h + 1);
    expect(after.lastSampleAt).toBeTruthy();

    const row = await db().prepare(
      `SELECT id, checked_at, d1_ok, cron_name
         FROM status_health_sample
        WHERE cron_name = '13 * * * *'
        ORDER BY checked_at DESC
        LIMIT 1`,
    ).first<{ id: string; checked_at: string; d1_ok: number; cron_name: string }>();
    expect(row?.d1_ok).toBe(1);
    expect(Number.isFinite(Date.parse(row!.checked_at))).toBe(true);
  });

  it("prunes samples older than the 7-day retention in the same write", async () => {
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await db().prepare(
      `INSERT INTO status_health_sample (id, checked_at, d1_ok, cron_name)
       VALUES ('stale-status-sample-1', ?, 1, 'seed')`,
    ).bind(stale).run();

    await recordStatusHealthSample(appEnv, "0 4 * * *");

    const staleRow = await db().prepare(
      `SELECT id FROM status_health_sample WHERE id = 'stale-status-sample-1'`,
    ).first<{ id: string }>();
    expect(staleRow).toBeNull();
  });

  it("measures surfaces without throwing and without confession vocabulary", async () => {
    const surfaces = await getPublicStatusSurfaces(appEnv);

    const ids = surfaces.surfaces.map((surface) => surface.id);
    expect(ids).toEqual([
      "public-search",
      "sign-in",
      "billing",
      "email",
      "monitoring",
      "uptime",
    ]);

    for (const surface of surfaces.surfaces) {
      expect(["operational", "degraded", "down"]).toContain(surface.state);
      if (surface.state === "degraded" || surface.state === "down") {
        expect(surface.reason).toBeTruthy();
      } else {
        expect(surface.reason).toBeNull();
      }
      expect(surface.source.length).toBeGreaterThan(0);
      // Every surface carries a checked timestamp.
      expect(Number.isFinite(Date.parse(surface.checkedAt))).toBe(true);
    }

    const serialized = JSON.stringify(surfaces).toLowerCase();
    for (const phrase of ["unavailable", "not measured", "not live-checked", "does not measure", "limited today"]) {
      expect(serialized).not.toContain(phrase);
    }
  });
});
