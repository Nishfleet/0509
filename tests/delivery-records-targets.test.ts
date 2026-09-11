import { afterEach, describe, expect, it } from "vitest";

import { upsertDeliveryTarget } from "~/lib/data/delivery-records-targets.server";
import { createSqliteD1 } from "./helpers/sqlite-d1";

const harnesses: Array<ReturnType<typeof createSqliteD1>> = [];

function openHarness() {
  const harness = createSqliteD1();
  harnesses.push(harness);
  harness.sqlite.exec(`
    CREATE TABLE delivery_target (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      watchlist_id TEXT,
      channel TEXT NOT NULL,
      target_value TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      is_validated INTEGER NOT NULL,
      is_opted_in INTEGER NOT NULL,
      opt_in_source TEXT,
      opted_in_at TEXT,
      is_paused INTEGER NOT NULL,
      paused_at TEXT,
      opted_out_at TEXT,
      template_eligible INTEGER NOT NULL,
      last_successful_delivery_at TEXT,
      last_successful_attempt_id TEXT,
      provider_identifier TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("upsertDeliveryTarget read-back (M10)", () => {
  it("binds the normalized targetValue in the read-back query", async () => {
    const harness = openHarness();
    const captured: Array<{ sql: string; bindings: unknown[] }> = [];
    const inner = harness.db.prepare.bind(harness.db);
    const env = {
      DB: {
        ...harness.db,
        prepare(sql: string) {
          const bound = inner(sql);
          return {
            bind(...bindings: unknown[]) {
              captured.push({ sql, bindings });
              return bound.bind(...bindings);
            },
          };
        },
      },
    } as never;

    await upsertDeliveryTarget(env, {
      userId: "user-1",
      watchlistId: null,
      channel: "email",
      targetValue: "  Alice@Example.COM  ",
      isOptedIn: true,
      isValidated: true,
      validationStatus: "validated",
    });

    const readBack = captured.filter(
      (entry) =>
        entry.sql.includes("FROM delivery_target") &&
        entry.sql.includes("ORDER BY updated_at DESC"),
    );
    expect(readBack.length).toBeGreaterThan(0);
    // listDeliveryTargets clause order: user_id, watchlist_id, channel,
    // targetValue, then LIMIT. The read-back must bind the normalized
    // targetValue so two same-channel targets for one user cannot return the
    // row that merely has the newest updated_at.
    const last = readBack[readBack.length - 1];
    expect(last.bindings.slice(0, 3)).toEqual([
      "user-1",
      "email",
      "alice@example.com",
    ]);
  });
});

// GREEN-only: not RED evidence. With the fix, each concurrent upsert's
// read-back filters on its own targetValue, so both must return their own row.
describe("upsertDeliveryTarget concurrent same-channel upserts",
  () => {
    it("returns each call's own target value", async () => {
      const harness = openHarness();
      const env = { DB: harness.db } as never;
      const input = {
        userId: "user-1",
        watchlistId: null,
        channel: "email" as const,
        isOptedIn: true,
        isValidated: true,
        validationStatus: "validated" as const,
      };

      const [a, b] = await Promise.all([
        upsertDeliveryTarget(env, { ...input, targetValue: "a@example.com" }),
        upsertDeliveryTarget(env, { ...input, targetValue: "b@example.com" }),
      ]);

      expect(a?.targetValue).toBe("a@example.com");
      expect(b?.targetValue).toBe("b@example.com");
    });
  },
);

describe("upsertDeliveryTarget concurrent first-time upserts (M11)", () => {
  it("both resolve to the target when no row exists yet", async () => {
    const harness = openHarness();
    harness.sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_target_unique_workspace
        ON delivery_target(user_id, channel, target_value)
        WHERE watchlist_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_target_unique_watchlist
        ON delivery_target(user_id, watchlist_id, channel, target_value)
        WHERE watchlist_id IS NOT NULL;
    `);
    const env = { DB: harness.db } as never;
    const input = {
      userId: "user-1",
      watchlistId: null,
      channel: "email" as const,
      targetValue: "shared@example.com",
      isOptedIn: true,
      isValidated: true,
      validationStatus: "validated" as const,
    };

    const [a, b] = await Promise.all([
      upsertDeliveryTarget(env, { ...input }),
      upsertDeliveryTarget(env, { ...input }),
    ]);

    expect(a?.targetValue).toBe("shared@example.com");
    expect(b?.targetValue).toBe("shared@example.com");

    // Exactly one row must exist: INSERT OR IGNORE on the partial unique
    // index means the loser's insert is dropped, not duplicated.
    const countRow = harness.sqlite
      .prepare("SELECT COUNT(*) AS n FROM delivery_target")
      .get() as { n: number };
    expect(countRow.n).toBe(1);
  });
});
