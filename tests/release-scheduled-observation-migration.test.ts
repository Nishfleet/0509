import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigration } from "./helpers/sqlite-d1";

const databases: DatabaseSync[] = [];

function database() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  applyMigration(db, "migrations/0070_release_scheduled_observations.sql");
  return db;
}

function insert(db: DatabaseSync, overrides: Record<string, unknown> = {}) {
  const value = {
    id: "observation-1",
    worker: "worker-v1",
    cron: "0 */3 * * *",
    task: "scheduled_monitoring",
    scheduled: "2026-07-19T06:00:00.000Z",
    started: "2026-07-19T06:00:00.100Z",
    completed: "2026-07-19T06:00:01.100Z",
    duration: 1000,
    outcome: "completed",
    category: null,
    metrics: "{}",
    created: "2026-07-19T06:00:01.100Z",
    ...overrides,
  };
  db.prepare(
    `
      INSERT INTO release_scheduled_observation (
        id, worker_version_id, cron, task_name, scheduled_at, started_at,
        completed_at, duration_ms, outcome, failure_category, metrics_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    value.id as string,
    value.worker as string,
    value.cron as string,
    value.task as string,
    value.scheduled as string,
    value.started as string,
    value.completed as string,
    value.duration as number,
    value.outcome as string,
    value.category as string | null,
    value.metrics as string,
    value.created as string,
  );
}

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

describe("release scheduled observation migration", () => {
  it("keeps duplicate scheduled attempts visible", () => {
    const db = database();
    insert(db);
    insert(db, { id: "observation-2" });
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM release_scheduled_observation")
      .get() as { count: number };
    expect(row.count).toBe(2);
  });

  it("enforces bounded outcomes, categories, durations, tasks, and metrics", () => {
    const db = database();
    expect(() => insert(db, { outcome: "success" })).toThrow();
    expect(() => insert(db, { outcome: "threw", category: null })).toThrow();
    expect(() =>
      insert(db, { outcome: "completed", category: "runtime_error" }),
    ).toThrow();
    expect(() => insert(db, { duration: 900001 })).toThrow();
    expect(() => insert(db, { task: "customer_private_task" })).toThrow();
    expect(() =>
      insert(db, {
        metrics: JSON.stringify({ value: "customer@example.com" }),
      }),
    ).toThrow();
    expect(() =>
      insert(db, {
        metrics: JSON.stringify({ queued: "customer@example.com" }),
      }),
    ).toThrow();
    expect(() => insert(db, { cron: "* * * * *" })).toThrow();
    expect(() =>
      insert(db, { cron: "0 5 * * MON", task: "weekly_business_numbers" }),
    ).not.toThrow();
  });

  it("allows only bounded integer redispatch-failure metrics after 0071", () => {
    const db = database();
    applyMigration(db, "migrations/0071_release_observation_redispatch_failures.sql");

    expect(() => insert(db, {
      metrics: JSON.stringify({ redispatchFailures: 2 }),
    })).not.toThrow();
    expect(() => db.prepare(`
      UPDATE release_scheduled_observation SET metrics_json = ? WHERE id = ?
    `).run(JSON.stringify({ redispatchFailures: 3 }), "observation-1")).not.toThrow();
    expect(() => db.prepare(`
      UPDATE release_scheduled_observation SET metrics_json = ? WHERE id = ?
    `).run(JSON.stringify({ redispatchFailures: "private" }), "observation-1")).toThrow();
    expect(() => db.prepare(`
      UPDATE release_scheduled_observation SET metrics_json = ? WHERE id = ?
    `).run(JSON.stringify({ unknownMetric: 1 }), "observation-1")).toThrow();
  });

  it("has no customer or provider identifier columns and creates both evidence indexes", () => {
    const db = database();
    const columns = db
      .prepare("PRAGMA table_info(release_scheduled_observation)")
      .all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);
    for (const forbidden of [
      "user_id",
      "workspace_id",
      "customer_id",
      "email",
      "provider_id",
      "message_id",
      "url",
      "payload",
      "error_message",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    const indexes = db
      .prepare("PRAGMA index_list(release_scheduled_observation)")
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "idx_release_scheduled_observation_version_window",
        "idx_release_scheduled_observation_retention",
      ]),
    );
  });
});
