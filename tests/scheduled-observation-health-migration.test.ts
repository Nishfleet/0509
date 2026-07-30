import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { SCHEDULED_OBSERVATION_DEADLINES } from "~/lib/scheduled-observation-health.server";

import { applyMigration } from "./helpers/sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

describe("scheduled observation health-state migration", () => {
  it("stores every configured deadline cron and rejects unsupported cron state", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0070_release_scheduled_observations.sql");
    applyMigration(db, "migrations/0072_scheduled_observation_health_state.sql");

    for (const { cron } of SCHEDULED_OBSERVATION_DEADLINES) {
      expect(() =>
        db.prepare(`
          INSERT INTO scheduled_observation_health_state (
            cron, baseline_at, had_observation, updated_at
          ) VALUES (?, ?, ?, ?)
        `).run(
          cron,
          "2026-07-30T12:13:00.000Z",
          0,
          "2026-07-30T12:13:00.000Z",
        ),
      ).not.toThrow();
    }

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
});
