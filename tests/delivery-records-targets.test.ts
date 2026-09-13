import { afterEach, describe, expect, it } from "vitest";

import {
  provisionVerifiedAccountEmailTargetIfUnsuppressed,
  upsertDeliveryTarget,
} from "~/lib/data/delivery-records-targets.server";
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

describe("provisionVerifiedAccountEmailTargetIfUnsuppressed idempotence (#3330)", () => {
  it("does not duplicate an existing active target for the same address", async () => {
    // The canary route provisions on EVERY run whose watchlist is missing
    // (cleanup keeps the proof target and drops the watchlist), and #3330's
    // early-return gap means the substrate-present path now calls it too.
    // The old WHERE NOT EXISTS only skipped opted-OUT rows, so an active row
    // still got a fresh duplicate insert — the next run then saw 2 matching
    // targets and Gate C 503'd `must resolve uniquely` forever.
    const harness = openHarness();
    const env = { DB: harness.db } as never;
    const input = {
      userId: "launch-readiness-canary-owner",
      targetValue: "alerts@0509.io",
      optInSource: "launch_readiness_canary_substrate",
    };

    const first = await provisionVerifiedAccountEmailTargetIfUnsuppressed(env, input);
    expect(first).not.toBeNull();
    const second = await provisionVerifiedAccountEmailTargetIfUnsuppressed(env, input);

    expect(second).not.toBeNull();
    const count = harness.sqlite.prepare("SELECT COUNT(*) AS c FROM delivery_target").get() as {
      c: number;
    };
    expect(count.c).toBe(1);
  });

  it("skips provisioning when the only row for the address is opted out", async () => {
    const harness = openHarness();
    const env = { DB: harness.db } as never;
    const first = await provisionVerifiedAccountEmailTargetIfUnsuppressed(env, {
      userId: "user-1",
      targetValue: "alerts@0509.io",
      optInSource: "launch_readiness_canary_substrate",
    });
    expect(first).not.toBeNull();
    harness.sqlite
      .prepare("UPDATE delivery_target SET opted_out_at = '2026-09-13T00:00:00.000Z' WHERE user_id = 'user-1'")
      .run();

    const reprovisioned = await provisionVerifiedAccountEmailTargetIfUnsuppressed(env, {
      userId: "user-1",
      targetValue: "alerts@0509.io",
      optInSource: "launch_readiness_canary_substrate",
    });

    // A suppressed address must never gain a fresh active row.
    expect(reprovisioned).toBeNull();
    const count = harness.sqlite.prepare("SELECT COUNT(*) AS c FROM delivery_target").get() as {
      c: number;
    };
    expect(count.c).toBe(1);
  });

  it("provisions when no row exists for the address", async () => {
    const harness = openHarness();
    const env = { DB: harness.db } as never;

    const target = await provisionVerifiedAccountEmailTargetIfUnsuppressed(env, {
      userId: "launch-readiness-canary-owner",
      targetValue: "alerts@0509.io",
      optInSource: "launch_readiness_canary_substrate",
    });

    expect(target).toMatchObject({
      userId: "launch-readiness-canary-owner",
      channel: "email",
      targetValue: "alerts@0509.io",
      isValidated: true,
      validationStatus: "validated",
      isOptedIn: true,
      isPaused: false,
      optedOutAt: null,
    });
  });
});
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
