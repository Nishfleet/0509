import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import {
  deleteExpiredProofCaptureArtifacts,
  deleteExpiredLandingPageSnapshots,
  MAX_SNAPSHOT_RETENTION_ROWS,
  runRetentionSweep,
} from "~/lib/retention.server";

const HTML_KEY = "landing-pages/2026-01-01/0123456789abcdef0123456789abcdef.html";
const SCREENSHOT_KEY = "landing-pages/2026-01-01/fedcba9876543210fedcba9876543210.jpeg";

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
              async all() {
                return { success: true, results: [] };
              },
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

    const tables = mock.statements.flatMap((statement) => {
      const table = statement.sql.match(/DELETE FROM (\w+)/)?.[1];
      return table ? [table] : [];
    });
    expect(tables).toEqual([
      "discovery_fetch_log",
      "browser_job_telemetry",
      "discovery_cache_entry",
      "better_auth_magic_link_ticket",
      "signup_source_pending",
      "meta_integration_log",
      "watchlist_run",
      "delivery_attempt",
      "presence_item",
      "release_scheduled_observation",
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
      landing_page_snapshot: 0,
    });
    expect(mock.statements.some((statement) => statement.sql.includes("FROM landing_page_snapshot AS snapshot"))).toBe(true);
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
    expect(mock.statements[1]?.bindings[0]).toBe("2026-06-15T12:00:00.000Z");
    expect(mock.statements[2]?.bindings[0]).toBe("2026-07-08T12:00:00.000Z");
  });

  it("continues the sweep when one table's delete fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                return { success: true, results: [] };
              },
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

    expect(statements.length).toBe(10);
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
              async all() {
                return { success: true, results: [] };
              },
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

  it("deletes R2 first and converges after a partial provider failure", async () => {
    let rowPresent = true;
    let screenshotDeleteFails = true;
    const objects = new Set([HTML_KEY, SCREENSHOT_KEY]);
    const events: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              async all() {
                if (sql.includes("FROM landing_page_snapshot AS snapshot")) {
                  return {
                    results: rowPresent
                      ? [{
                          id: "snapshot-1",
                          artifact_key: HTML_KEY,
                          metadata_json: JSON.stringify({
                            htmlArtifactKey: HTML_KEY,
                            screenshotArtifactKey: SCREENSHOT_KEY,
                          }),
                        }]
                      : [],
                  };
                }
                if (sql.includes("AS external_references")) {
                  return { results: [{ external_references: 0 }] };
                }
                throw new Error(`unexpected all: ${sql}`);
              },
              async run() {
                if (!sql.includes("DELETE FROM landing_page_snapshot")) {
                  throw new Error(`unexpected run: ${sql}`);
                }
                events.push("d1:delete");
                expect(bindings[0]).toBe("snapshot-1");
                rowPresent = false;
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };
    const bucket = {
      async head(key: string) {
        events.push(`r2:head:${key}`);
        return objects.has(key) ? ({ key } as R2Object) : null;
      },
      async delete(key: string) {
        events.push(`r2:delete:${key}`);
        if (key === SCREENSHOT_KEY && screenshotDeleteFails) {
          screenshotDeleteFails = false;
          throw new Error("temporary R2 failure");
        }
        objects.delete(key);
      },
    };
    const env = { DB: db as D1Database, LANDING_PAGE_ARTIFACTS: bucket as unknown as R2Bucket } as never;

    const first = await deleteExpiredLandingPageSnapshots(env, { cutoff: "2026-04-01T00:00:00.000Z" });
    expect(first).toEqual({ deleted: 0, failed: 1 });
    expect(rowPresent).toBe(true);
    expect(objects.has(HTML_KEY)).toBe(false);
    expect(events).not.toContain("d1:delete");

    const second = await deleteExpiredLandingPageSnapshots(env, { cutoff: "2026-04-01T00:00:00.000Z" });
    expect(second).toEqual({ deleted: 1, failed: 0 });
    expect(objects.size).toBe(0);
    expect(events.at(-1)).toBe("d1:delete");
  });

  it("keeps externally referenced objects while deleting only the expired snapshot row", async () => {
    const r2Head = vi.fn();
    const r2Delete = vi.fn();
    const sqlBindings: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            sqlBindings.push(bindings);
            return {
              async all() {
                if (sql.includes("FROM landing_page_snapshot AS snapshot")) {
                  return { results: [{ id: "snapshot-1", artifact_key: HTML_KEY, metadata_json: "{}" }] };
                }
                return { results: [{ external_references: 1 }] };
              },
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    const result = await deleteExpiredLandingPageSnapshots(
      { DB: db as D1Database, LANDING_PAGE_ARTIFACTS: { head: r2Head, delete: r2Delete } as unknown as R2Bucket } as never,
      { cutoff: "2026-04-01T00:00:00.000Z", limit: 999 },
    );

    expect(result).toEqual({ deleted: 1, failed: 0 });
    expect(r2Head).not.toHaveBeenCalled();
    expect(r2Delete).not.toHaveBeenCalled();
    expect(sqlBindings[0]?.at(-1)).toBe(MAX_SNAPSHOT_RETENTION_ROWS);
  });
});

describe("active proof artifact retention", () => {
  it("cleans an expired unreferenced proof artifact R2-first and keeps the proof row", async () => {
    const events: string[] = [];
    let objectPresent = true;
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              async all() {
                if (sql.includes("ORDER BY proof_capture.created_at")) {
                  return { results: [{
                    id: "proof-old",
                    owner_user_id: "owner-1",
                    html_artifact_key: HTML_KEY,
                    screenshot_artifact_key: null,
                  }] };
                }
                if (sql.includes("other.id <>")) return { results: [{ external_references: 0 }] };
                if (sql.includes("references_for_key")) {
                  return { results: [{
                    reference_count: 1,
                    owner_count: 1,
                    owner_match_count: 1,
                    landing_page_snapshot_references: 0,
                    proof_capture_references: 1,
                  }] };
                }
                throw new Error(`unexpected all: ${sql}`);
              },
              async run() {
                expect(sql).toContain("UPDATE proof_capture");
                events.push("d1:clear");
                expect(bindings).toContain(HTML_KEY);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };
    const bucket = {
      async head(key: string) {
        events.push("r2:head");
        return objectPresent ? ({ key } as R2Object) : null;
      },
      async delete() {
        events.push("r2:delete");
        objectPresent = false;
      },
    };

    await expect(deleteExpiredProofCaptureArtifacts(
      { DB: db as D1Database, LANDING_PAGE_ARTIFACTS: bucket as unknown as R2Bucket } as never,
      { cutoff: "2026-04-01T00:00:00.000Z" },
    )).resolves.toEqual({ cleared: 1, failed: 0 });
    expect(events).toEqual(["r2:head", "r2:delete", "d1:clear"]);
  });

  it("source-selects only bounded captures outside active pointers, events, and digests", async () => {
    const mock = createCapturingDb();
    await deleteExpiredProofCaptureArtifacts(
      { DB: mock.db } as never,
      { cutoff: "2026-04-01T00:00:00.000Z", limit: 999 },
    );
    const sql = mock.statements[0]?.sql ?? "";
    expect(sql).toContain("last_successful_capture_id");
    expect(sql).toContain("watch_event.proof_capture_id");
    expect(sql).toContain("$.proofCaptureId");
    expect(mock.statements[0]?.bindings.at(-1)).toBe(MAX_SNAPSHOT_RETENTION_ROWS);
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

describe("browser_job_telemetry retention", () => {
  it("deletes only rows older than 30 days via the indexed created_at path", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      readFileSync("migrations/0076_browser_job_telemetry.sql", "utf8"),
    );
    const insert = sqlite.prepare(
      "INSERT INTO browser_job_telemetry (id, job_id, idempotency_key, job_kind, actual_provider, route_context, plan_tier, source, attempt, started_at, ended_at, duration_ms, browser_ms_used, cache_status, cache_age_ms, outcome, result_count, result_bytes, worker_version, cron_task, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const now = new Date("2026-08-13T00:00:00.000Z");
    const iso = (daysAgo: number) =>
      new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const base: Array<string | number | null> = [
      "job-0001",
      "deadbeef".repeat(8),
      "meta_discovery",
      "cloudflare_browser_run",
      "public_search",
      null,
      "manual",
      1,
      iso(1),
      iso(1),
      100,
      null,
      null,
      null,
      "succeeded",
      3,
      null,
      null,
      null,
    ];
    for (const [id, daysAgo] of [
      ["id-old-31", 31],
      ["id-old-40", 40],
      ["id-new-5", 5],
    ] as Array<[string, number]>) {
      insert.run(id, ...base, iso(daysAgo));
    }

    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            const bound = bindings;
            return {
              async run() {
                const result = sqlite
                  .prepare(sql)
                  .run(...(bound as Array<string | number | null | bigint>));
                return {
                  success: true,
                  meta: { changes: Number(result.changes ?? 0) },
                };
              },
            };
          },
        };
      },
    };

    const result = await runRetentionSweep({ DB: db } as never, { now });

    expect(result.deleted.browser_job_telemetry).toBe(2);
    const remaining = sqlite
      .prepare("SELECT id FROM browser_job_telemetry ORDER BY id")
      .all() as Array<{ id: string }>;
    expect(remaining.map((row) => row.id)).toEqual(["id-new-5"]);
    sqlite.close();
  });
});
