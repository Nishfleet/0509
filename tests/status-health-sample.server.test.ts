import { describe, expect, it, vi } from "vitest";

import {
  recordStatusHealthSample,
  readStatusUptime,
  STATUS_HEALTH_SAMPLE_RETENTION_MS,
} from "~/lib/scheduled-observation-health.server";

/**
 * The /status uptime rail: every scheduled() invocation writes one
 * status_health_sample row (edge ran + D1 SELECT 1), pruning past 7 days in
 * the same batch. These unit tests pin the write/read contract against a
 * scripted D1 binding; the real migrated-D1 write/read path is covered by
 * tests/integration/status-health-sample.integration.test.ts.
 */

function makeEnv() {
  const executed: Array<{ sql: string; bindings: unknown[] }> = [];
  const stmt = (sql: string) => ({
    bind: (...bindings: unknown[]) => {
      executed.push({ sql, bindings });
      return {
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        first: vi.fn().mockResolvedValue(sql.includes("SELECT 1") ? { "1": 1 } : null),
      };
    },
    first: vi.fn().mockResolvedValue(sql.includes("SELECT 1") ? { "1": 1 } : null),
  });
  const DB = {
    prepare: vi.fn(stmt),
    batch: vi.fn().mockResolvedValue([]),
  };
  return { env: { DB } as never, executed, DB };
}

describe("recordStatusHealthSample", () => {
  it("probes D1 and writes one bounded sample with retention pruning", async () => {
    const { env, executed, DB } = makeEnv();
    const now = new Date("2026-09-12T04:00:00.000Z");

    const ok = await recordStatusHealthSample(env, "13 * * * *", { now });

    expect(ok).toBe(true);
    expect(DB.prepare).toHaveBeenCalledWith("SELECT 1");
    expect(executed.length).toBe(2);

    const [insert, prune] = executed;
    expect(insert.sql).toContain("INSERT INTO status_health_sample");
    expect(insert.sql).toContain("d1_ok");
    expect(insert.bindings[1]).toBe("2026-09-12T04:00:00.000Z");
    expect(insert.bindings[2]).toBe(1);
    expect(insert.bindings[3]).toBe("13 * * * *");

    expect(prune.sql).toContain("DELETE FROM status_health_sample");
    expect(prune.bindings[0]).toBe(
      new Date(now.getTime() - STATUS_HEALTH_SAMPLE_RETENTION_MS).toISOString(),
    );
  });

  it("records d1_ok = 0 when the storage probe fails, and never throws to the cron", async () => {
    const executed: Array<{ sql: string; bindings: unknown[] }> = [];
    const DB = {
      prepare: vi.fn((sql: string) => ({
        bind: (...bindings: unknown[]) => {
          executed.push({ sql, bindings });
          if (sql === "SELECT 1") {
            return { first: vi.fn().mockRejectedValue(new Error("d1 down")) };
          }
          return { run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) };
        },
        first: vi.fn().mockRejectedValue(new Error("d1 down")),
      })),
      batch: vi.fn().mockResolvedValue([]),
    };
    const env = { DB } as never;

    await expect(
      recordStatusHealthSample(env, "0 */3 * * *", { now: new Date("2026-09-12T04:00:00.000Z") }),
    ).resolves.toBe(true);

    const insert = executed.find((entry) => entry.sql.includes("INSERT INTO"));
    expect(insert?.bindings[2]).toBe(0);
  });

  it("swallows a total write failure so the carrying cron never fails", async () => {
    const DB = {
      prepare: vi.fn(() => {
        throw new Error("binding gone");
      }),
      batch: vi.fn(),
    };
    const env = { DB } as never;
    await expect(
      recordStatusHealthSample(env, "13 * * * *", { now: new Date("2026-09-12T04:00:00.000Z") }),
    ).resolves.toBe(false);
  });

  it("is a no-op without a DB binding", async () => {
    await expect(
      recordStatusHealthSample({} as never, "13 * * * *"),
    ).resolves.toBe(false);
  });
});

describe("readStatusUptime", () => {
  it("counts 24h samples and the last sample timestamp", async () => {
    const executed: Array<{ sql: string; bindings: unknown[] }> = [];
    const DB = {
      prepare: vi.fn((sql: string) => ({
        bind: (...bindings: unknown[]) => {
          executed.push({ sql, bindings });
          return {
            first: vi.fn().mockResolvedValue(
              sql.includes("COUNT(*)") ? { total: 27, ok: 26 } : { last_sample_at: "2026-09-12T03:13:00.000Z" },
            ),
          };
        },
        first: vi.fn().mockResolvedValue(
          sql.includes("COUNT(*)") ? { total: 27, ok: 26 } : { last_sample_at: "2026-09-12T03:13:00.000Z" },
        ),
      })),
    };
    const env = { DB } as never;

    await expect(readStatusUptime(env)).resolves.toEqual({
      samples24h: 27,
      okSamples24h: 26,
      lastSampleAt: "2026-09-12T03:13:00.000Z",
    });
    const countSql = executed.find((entry) => entry.sql.includes("COUNT(*)"));
    expect(countSql?.sql).toContain("checked_at >=");
  });

  it("reads zero samples (never throws) when D1 is down or unbound", async () => {
    await expect(readStatusUptime({} as never)).resolves.toEqual({
      samples24h: 0,
      okSamples24h: 0,
      lastSampleAt: null,
    });

    const DB = {
      prepare: vi.fn(() => {
        throw new Error("no such table");
      }),
    };
    await expect(readStatusUptime({ DB } as never)).resolves.toEqual({
      samples24h: 0,
      okSamples24h: 0,
      lastSampleAt: null,
    });
  });
});
