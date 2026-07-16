import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { runRetentionSweep } from "~/lib/retention.server";

function createCapturingDb() {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async run() {
                return { success: true, meta: { changes: 2 } };
              },
            };
          },
        };
      },
    },
  };
}

describe("runRetentionSweep", () => {
  it("deletes bounded batches from every unbounded table and reports counts", async () => {
    const mock = createCapturingDb();

    const result = await runRetentionSweep({ DB: mock.db } as never);

    const tables = mock.statements.map((statement) =>
      statement.sql.match(/DELETE FROM (\w+)/)?.[1],
    );
    expect(tables).toEqual([
      "discovery_fetch_log",
      "discovery_cache_entry",
      "better_auth_magic_link_ticket",
      "meta_integration_log",
      "watchlist_run",
      "delivery_attempt",
      "landing_page_snapshot",
      "presence_item",
    ]);

    // every delete is batched — an unbounded DELETE could blow the cron budget
    for (const statement of mock.statements) {
      expect(statement.sql).toContain("LIMIT");
    }

    expect(result.deleted).toMatchObject({
      better_auth_magic_link_ticket: 2,
      discovery_fetch_log: 2,
      watchlist_run: 2,
      delivery_attempt: 2,
    });
  });

  it("never touches billing history or customer-facing digest history", async () => {
    const mock = createCapturingDb();

    await runRetentionSweep({ DB: mock.db } as never);

    const allSql = mock.statements.map((statement) => statement.sql).join("\n");
    expect(allSql).not.toContain("DELETE FROM digest_run");
    expect(allSql).not.toContain("DELETE FROM digest_item");
    expect(allSql).not.toContain("DELETE FROM proof_usage_credit");
    expect(allSql).not.toContain("DELETE FROM dodo_webhook_event");
  });

  it("protects change-detection baselines and the newest runs per watchlist", async () => {
    const mock = createCapturingDb();

    await runRetentionSweep({ DB: mock.db } as never);

    const runDelete = mock.statements.find((statement) =>
      statement.sql.includes("DELETE FROM watchlist_run"),
    );
    expect(runDelete?.sql).toContain("baseline_from_run_id IS NOT NULL");
    expect(runDelete?.sql).toContain("ROW_NUMBER() OVER");
    expect(runDelete?.bindings[0]).toBe(5);
  });

  it("accepts an explicit server clock without changing the process clock", async () => {
    const mock = createCapturingDb();
    const now = new Date("2026-07-15T12:00:00.000Z");

    await runRetentionSweep({ DB: mock.db } as never, { now });

    expect(mock.statements[0]?.bindings[0]).toBe("2026-06-15T12:00:00.000Z");
    expect(mock.statements[1]?.bindings[0]).toBe("2026-07-08T12:00:00.000Z");
  });

  it("continues the sweep when one table's delete fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                statements.push(sql);
                if (sql.includes("discovery_cache_entry")) {
                  throw new Error("locked");
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    const result = await runRetentionSweep({ DB: db } as never);

    expect(statements.length).toBe(8);
    expect(result.deleted.discovery_cache_entry).toBeUndefined();
    expect(result.deleted.delivery_attempt).toBe(1);
    expect(result.failedSteps).toEqual(["discovery_cache_entry"]);
    consoleError.mockRestore();
  });

  it("returns only deterministic step names when a deletion exposes sensitive error details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                if (sql.includes("meta_integration_log")) {
                  throw new Error("D1 token=super-secret SQL=SELECT * FROM private_data");
                }
                return { success: true, meta: { changes: 0 } };
              },
            };
          },
        };
      },
    };

    const result = await runRetentionSweep({ DB: db } as never);

    expect(result.failedSteps).toEqual(["meta_integration_log"]);
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("private_data");
    consoleError.mockRestore();
  });
});

describe("hot-path index migration", () => {
  it("is additive only and covers the audited full-scan queries", () => {
    const migration = readFileSync("migrations/0022_hot_path_indexes.sql", "utf8");

    expect(migration).not.toMatch(/DROP|ALTER|DELETE|UPDATE/i);
    expect(migration).toContain("idx_delivery_attempt_provider_message");
    expect(migration).toContain("idx_delivery_attempt_user_created");
    expect(migration).toContain("idx_watchlist_run_status_started");
    expect(migration).toContain("idx_discovery_fetch_log_status_created");
    expect(migration).toContain("idx_user_email_nocase");
    expect(migration).toContain("idx_discovery_cache_expires");
  });
});
