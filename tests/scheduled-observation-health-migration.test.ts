import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { SCHEDULED_OBSERVATION_DEADLINES } from "~/lib/scheduled-observation-health.server";

import { applyMigration } from "./helpers/sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

describe("scheduled observation health-state migration", () => {
  it("seeds every configured deadline cron and rejects unsupported cron state", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0070_release_scheduled_observations.sql");
    applyMigration(db, "migrations/0072_scheduled_observation_health_state.sql");

    const rows = db.prepare(`
      SELECT cron, baseline_at
      FROM scheduled_observation_health_state
      ORDER BY cron
    `).all() as Array<{ cron: string; baseline_at: string }>;
    expect(rows.map((row) => row.cron).sort()).toEqual(
      SCHEDULED_OBSERVATION_DEADLINES.map(({ cron }) => cron).sort(),
    );
    expect(rows.every((row) => Number.isFinite(Date.parse(row.baseline_at)))).toBe(true);

    expect(() =>
      db.prepare(`
        INSERT INTO scheduled_observation_health_state (
          cron, baseline_at, had_observation, updated_at
        ) VALUES (?, ?, ?, ?)
      `).run(
        "* * * * *",
        "2026-07-30T12:13:00.000Z",
        0,
        "2026-07-30T12:13:00.000Z",
      ),
    ).toThrow();
  });

  it("preserves seeded baselines when the migration is replayed", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0070_release_scheduled_observations.sql");
    applyMigration(db, "migrations/0072_scheduled_observation_health_state.sql");
    const before = db.prepare(`
      SELECT cron, baseline_at FROM scheduled_observation_health_state ORDER BY cron
    `).all();

    applyMigration(db, "migrations/0072_scheduled_observation_health_state.sql");

    expect(db.prepare(`
      SELECT cron, baseline_at FROM scheduled_observation_health_state ORDER BY cron
    `).all()).toEqual(before);
  });

  it("indexes cron freshness lookups on scheduled observation evidence", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0070_release_scheduled_observations.sql");
    applyMigration(db, "migrations/0072_scheduled_observation_health_state.sql");

    const indexes = db
      .prepare("PRAGMA index_list(release_scheduled_observation)")
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain(
      "idx_release_scheduled_observation_cron_scheduled",
    );
  });

  it("keeps gap-alert throttle state aggregate-only", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0070_release_scheduled_observations.sql");
    applyMigration(db, "migrations/0072_scheduled_observation_health_state.sql");

    const columns = db.prepare("PRAGMA table_info(scheduled_observation_alert_state)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      "alert_key",
      "last_alerted_at",
      "unhealthy_mask",
      "last_attempted_at",
      "last_attempt_outcome",
    ]);
    expect(() => db.prepare(`
      INSERT INTO scheduled_observation_alert_state (
        alert_key, last_alerted_at, unhealthy_mask,
        last_attempted_at, last_attempt_outcome
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      "other",
      "2026-07-30T12:00:00.000Z",
      1,
      "2026-07-30T12:00:00.000Z",
      "accepted",
    )).toThrow();
    expect(() => db.prepare(`
      INSERT INTO scheduled_observation_alert_state (
        alert_key, last_alerted_at, unhealthy_mask,
        last_attempted_at, last_attempt_outcome
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      "scheduled_observation_gap",
      "2026-07-30T12:00:00.000Z",
      32,
      "2026-07-30T12:00:00.000Z",
      "accepted",
    )).toThrow();
  });
});
