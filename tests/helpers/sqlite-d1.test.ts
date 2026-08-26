import { afterEach, describe, expect, it } from "vitest";

import { createSqliteD1 } from "./sqlite-d1";

const harnesses: Array<ReturnType<typeof createSqliteD1>> = [];

function openHarness() {
  const harness = createSqliteD1();
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  while (harnesses.length > 0) {
    harnesses.pop()?.close();
  }
});

describe("createSqliteD1 numbered D1 placeholders", () => {
  it("reuses a numbered placeholder the way D1 bind() does", async () => {
    const { db, sqlite } = openHarness();
    sqlite.exec(`
      CREATE TABLE item (
        id INTEGER PRIMARY KEY,
        first TEXT,
        second TEXT
      );
      INSERT INTO item (id) VALUES (1);
    `);

    const result = await db
      .prepare(
        `
          UPDATE item
          SET first = ?1,
              second = ?1
          WHERE id = ?2
        `,
      )
      .bind("same", 1)
      .run();

    expect(result.meta.changes).toBe(1);
    expect(
      await db.prepare("SELECT first, second FROM item WHERE first = ?1 AND second = ?1").bind("same").first<{
        first: string;
        second: string;
      }>(),
    ).toEqual({
      first: "same",
      second: "same",
    });
  });

  it("runs the claimMonitoringConcurrencySlot UPDATE that repeats ?5", async () => {
    const { db, sqlite } = openHarness();
    sqlite.exec(`
      CREATE TABLE monitoring_concurrency_slot (
        slot_index INTEGER PRIMARY KEY,
        holder_run_id TEXT,
        holder_token TEXT,
        leased_at TEXT
      );
      INSERT INTO monitoring_concurrency_slot (slot_index) VALUES (1), (2), (3), (4);
    `);

    const result = await db
      .prepare(
        `
          UPDATE monitoring_concurrency_slot
          SET holder_run_id = ?1,
              holder_token = ?2,
              leased_at = ?3
          WHERE slot_index = (
            SELECT slot_index
            FROM monitoring_concurrency_slot
            WHERE slot_index < ?4
              AND (
                holder_run_id IS NULL
                OR leased_at < ?5
              )
            ORDER BY CASE WHEN holder_run_id IS NULL THEN 0 ELSE 1 END, leased_at ASC
            LIMIT 1
          )
          AND (
            holder_run_id IS NULL
            OR leased_at < ?5
          )
        `,
      )
      .bind("run-1", "token-1", "2026-06-23T00:00:00.000Z", 4, "2020-01-01T00:00:00.000Z")
      .run();

    expect(result.meta.changes).toBe(1);
    expect(
      sqlite.prepare("SELECT holder_run_id, holder_token FROM monitoring_concurrency_slot WHERE slot_index = 1").get(),
    ).toEqual({
      holder_run_id: "run-1",
      holder_token: "token-1",
    });
  });

  it("still binds anonymous placeholders positionally", async () => {
    const { db, sqlite } = openHarness();
    sqlite.exec("CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT);");

    await db.prepare("INSERT INTO item (id, name) VALUES (?, ?)").bind(7, "anon").run();

    expect(await db.prepare("SELECT name FROM item WHERE id = ?").bind(7).first<{ name: string }>()).toEqual({
      name: "anon",
    });
    expect(
      (await db.prepare("SELECT name FROM item WHERE id = ?").bind(7).all<{ name: string }>()).results,
    ).toEqual([{ name: "anon" }]);
  });
});
