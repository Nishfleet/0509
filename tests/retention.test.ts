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
    expect(allSql).not.toContain("DELETE FROM razorpay_webhook_event");
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
