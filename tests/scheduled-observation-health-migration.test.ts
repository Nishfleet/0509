import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigration } from "./helpers/sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

describe("scheduled observation health-state migration", () => {
  it("stores only allowlisted cron activation state", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    applyMigration(db, "migrations/0072_scheduled_observation_health_state.sql");

    db.prepare(`
      INSERT INTO scheduled_observation_health_state (
        cron, baseline_at, had_observation, updated_at
      ) VALUES (?, ?, ?, ?)
    `).run(
      "0 */3 * * *",
      "2026-07-30T12:13:00.000Z",
      0,
      "2026-07-30T12:13:00.000Z",
    );

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
});
