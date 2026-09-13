import { afterEach, describe, expect, it } from "vitest";

import {
  repairCanaryProofEmailTarget,
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
    CREATE TABLE email_suppression (
      address TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint')),
      source TEXT NOT NULL,
      detail TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (address, reason)
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
describe("upsertDeliveryTarget concurrent same-channel upserts", () => {
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
});

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

describe("repairCanaryProofEmailTarget (Gate C canary substrate self-heal)", () => {
  function seedRow(
    harness: ReturnType<typeof createSqliteD1>,
    overrides: Partial<{
      id: string;
      user_id: string;
      target_value: string;
      validation_status: string;
      is_validated: number;
      is_opted_in: number;
      is_paused: number;
      opted_out_at: string | null;
      created_at: string;
    }>,
  ) {
    const row = {
      id: overrides.id ?? `row-${Math.random().toString(36).slice(2)}`,
      user_id: overrides.user_id ?? "canary-user",
      watchlist_id: null,
      channel: "email",
      target_value: overrides.target_value ?? "canary@0509.io",
      validation_status: overrides.validation_status ?? "validated",
      is_validated: overrides.is_validated ?? 1,
      is_opted_in: overrides.is_opted_in ?? 1,
      opt_in_source: "launch_readiness_canary_substrate",
      opted_in_at: "2026-09-01T00:00:00.000Z",
      is_paused: overrides.is_paused ?? 0,
      paused_at: null,
      opted_out_at: overrides.opted_out_at ?? null,
      template_eligible: 0,
      last_successful_delivery_at: null,
      last_successful_attempt_id: null,
      provider_identifier: null,
      metadata_json: "{}",
      created_at: overrides.created_at ?? "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
      ...overrides,
    };
    harness.sqlite
      .prepare(
        `INSERT INTO delivery_target
           (id, user_id, watchlist_id, channel, target_value, validation_status,
            is_validated, is_opted_in, opt_in_source, opted_in_at, is_paused,
            paused_at, opted_out_at, template_eligible, last_successful_delivery_at,
            last_successful_attempt_id, provider_identifier, metadata_json,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.user_id,
        row.watchlist_id,
        row.channel,
        row.target_value,
        row.validation_status,
        row.is_validated,
        row.is_opted_in,
        row.opt_in_source,
        row.opted_in_at,
        row.is_paused,
        row.paused_at,
        row.opted_out_at,
        row.template_eligible,
        row.last_successful_delivery_at,
        row.last_successful_attempt_id,
        row.provider_identifier,
        row.metadata_json,
        row.created_at,
        row.updated_at,
      );
    return row;
  }

  it("repairs an opted-out canary row back to the provisioned state (zero-usable-rows drift)", async () => {
    const harness = openHarness();
    seedRow(harness, {
      id: "opted-out",
      opted_out_at: "2026-09-09T17:03:00.000Z",
    });
    const env = { DB: harness.db } as never;

    const result = await repairCanaryProofEmailTarget(env, {
      userId: "canary-user",
      canaryEmail: "canary@0509.io",
    });

    expect(result).toEqual({ kept: 1, removed: 0, repaired: true });
    const row = harness.sqlite
      .prepare("SELECT * FROM delivery_target WHERE id = 'opted-out'")
      .get() as {
      opted_out_at: string | null;
      is_paused: number;
      is_opted_in: number;
      is_validated: number;
      validation_status: string;
    };
    expect(row.opted_out_at).toBeNull();
    expect(row.is_paused).toBe(0);
    expect(row.is_opted_in).toBe(1);
    expect(row.is_validated).toBe(1);
    expect(row.validation_status).toBe("validated");
  });

  it("collapses byte-distinct rows that normalize to the same address to one usable row", async () => {
    const harness = openHarness();
    seedRow(harness, {
      id: "old-spelling",
      target_value: "Canary@0509.io",
      created_at: "2026-09-01T00:00:00.000Z",
    });
    seedRow(harness, {
      id: "new-spelling",
      target_value: "canary@0509.io",
      created_at: "2026-09-10T00:00:00.000Z",
    });
    const env = { DB: harness.db } as never;

    const result = await repairCanaryProofEmailTarget(env, {
      userId: "canary-user",
      canaryEmail: "canary@0509.io",
    });

    expect(result).toEqual({ kept: 1, removed: 1, repaired: true });
    const rows = harness.sqlite
      .prepare("SELECT id, opted_out_at, is_validated FROM delivery_target")
      .all() as Array<{
      id: string;
      opted_out_at: string | null;
      is_validated: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("old-spelling");
    expect(rows[0].opted_out_at).toBeNull();
    expect(rows[0].is_validated).toBe(1);
  });

  it("leaves a healthy single canary row untouched apart from the read-back", async () => {
    const harness = openHarness();
    seedRow(harness, { id: "healthy" });
    const env = { DB: harness.db } as never;

    const result = await repairCanaryProofEmailTarget(env, {
      userId: "canary-user",
      canaryEmail: "canary@0509.io",
    });

    expect(result).toEqual({ kept: 1, removed: 0, repaired: true });
    const row = harness.sqlite
      .prepare(
        "SELECT target_value, validation_status, is_paused, opted_out_at, opted_in_at FROM delivery_target WHERE id = 'healthy'",
      )
      .get() as {
      target_value: string;
      validation_status: string;
      is_paused: number;
      opted_out_at: string | null;
      opted_in_at: string;
    };
    expect(row.target_value).toBe("canary@0509.io");
    expect(row.validation_status).toBe("validated");
    expect(row.is_paused).toBe(0);
    expect(row.opted_out_at).toBeNull();
    expect(row.opted_in_at).toBe("2026-09-01T00:00:00.000Z");
  });
});
