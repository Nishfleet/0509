import { sql, type Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { D1_MAX_BOUND_PARAMS } from "~/lib/d1-chunk.server";
import {
  ensureDb,
  execute,
  kyselyDb,
  queryAll,
  queryIn,
  queryOne,
} from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";

import { createSqliteD1 } from "./helpers/sqlite-d1";

type Prepared = {
  bind: (...bindings: unknown[]) => Prepared;
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta: { changes: number } }>;
};

function createMockEnv(handler: {
  onPrepare?: (sql: string) => void;
  onBind?: (bindings: unknown[]) => void;
  rows?: unknown[];
  runMeta?: { changes: number };
}) {
  const prepared: Prepared = {
    bind(...bindings: unknown[]) {
      handler.onBind?.(bindings);
      return prepared;
    },
    async all() {
      return { results: (handler.rows ?? []) as never[] };
    },
    async first() {
      const rows = handler.rows ?? [];
      return (rows[0] ?? null) as never;
    },
    async run() {
      return { meta: handler.runMeta ?? { changes: 1 } };
    },
  };

  const env = {
    DB: {
      prepare(sql: string) {
        handler.onPrepare?.(sql);
        return prepared;
      },
    },
  } as unknown as AppEnv;

  return env;
}

describe("d1.server helpers", () => {
  it("ensureDb throws when DB is missing", () => {
    expect(() => ensureDb({} as AppEnv)).toThrow(/D1 binding `DB` is not configured/);
  });

  it("queryAll / queryOne / execute bind and return rows", async () => {
    const binds: unknown[][] = [];
    const env = createMockEnv({
      rows: [{ id: "a" }, { id: "b" }],
      onBind: (bindings) => binds.push(bindings),
      runMeta: { changes: 2 },
    });

    expect(await queryAll<{ id: string }>(env, "SELECT 1", "x")).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
    expect(await queryOne<{ id: string }>(env, "SELECT 1", "y")).toEqual({ id: "a" });
    expect((await execute(env, "UPDATE t SET a = ?", 1)).meta.changes).toBe(2);
    expect(binds).toEqual([["x"], ["y"], [1]]);
  });

  it("queryOne returns null when there are no rows", async () => {
    const env = createMockEnv({ rows: [] });
    expect(await queryOne(env, "SELECT 1")).toBeNull();
  });

  it("queryIn returns [] without querying when values are empty", async () => {
    const onPrepare = vi.fn();
    const env = createMockEnv({ onPrepare });
    expect(
      await queryIn(env, {
        buildSql: (placeholders) => `SELECT * FROM t WHERE id IN (${placeholders})`,
        values: [],
      }),
    ).toEqual([]);
    expect(onPrepare).not.toHaveBeenCalled();
  });

  it("queryIn chunks through d1-chunk and preserves prefix/suffix bindings", async () => {
    const sqls: string[] = [];
    const binds: unknown[][] = [];
    const env = createMockEnv({
      rows: [{ id: "row" }],
      onPrepare: (sql) => sqls.push(sql),
      onBind: (bindings) => binds.push(bindings),
    });

    const values = Array.from({ length: D1_MAX_BOUND_PARAMS + 5 }, (_, i) => `id-${i}`);
    const rows = await queryIn<{ id: string }>(env, {
      buildSql: (placeholders) =>
        `SELECT * FROM t WHERE user_id = ? AND id IN (${placeholders}) AND active = ?`,
      values,
      prefix: ["user-1"],
      suffix: [1],
    });

    expect(rows.length).toBe(2);
    expect(sqls).toHaveLength(2);
    expect(sqls[0]).toContain(`IN (${Array(D1_MAX_BOUND_PARAMS - 2).fill("?").join(", ")})`);
    expect(binds[0]?.[0]).toBe("user-1");
    expect(binds[0]?.at(-1)).toBe(1);
    expect(binds[0]?.length).toBe(D1_MAX_BOUND_PARAMS);
    expect(binds[1]?.length).toBe(1 + 7 + 1);
  });

  it("queryIn honors an explicit chunkSize", async () => {
    const binds: unknown[][] = [];
    const env = createMockEnv({
      rows: [],
      onBind: (bindings) => binds.push(bindings),
    });

    await queryIn(env, {
      buildSql: (placeholders) => `SELECT * FROM t WHERE id IN (${placeholders})`,
      values: ["a", "b", "c", "d", "e"],
      chunkSize: 2,
    });

    expect(binds.map((b) => b.length)).toEqual([2, 2, 1]);
  });
});

describe("kyselyDb", () => {
  it("throws when DB is missing", () => {
    expect(() => kyselyDb({} as AppEnv)).toThrow(/D1 binding `DB` is not configured/);
  });

  it("binds parameters and camel-cases raw query results", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec(
        "CREATE TABLE widget (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL)",
      );
      await sqlite.db
        .prepare("INSERT INTO widget (id, user_id, created_at) VALUES (?, ?, ?)")
        .bind("w1", "u1", "2026-09-20")
        .run();

      const env = { DB: sqlite.db } as unknown as AppEnv;
      const result = await sql<{ userId: string; createdAt: string }>`
        SELECT user_id, created_at FROM widget WHERE id = ${"w1"}
      `.execute(kyselyDb(env));

      expect(result.rows).toEqual([{ userId: "u1", createdAt: "2026-09-20" }]);
    } finally {
      sqlite.close();
    }
  });

  it("translates camelCase schema identifiers to snake_case columns", async () => {
    const sqlite = createSqliteD1();
    try {
      sqlite.sqlite.exec("CREATE TABLE widget (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)");
      await sqlite.db
        .prepare("INSERT INTO widget (id, user_id) VALUES (?, ?)")
        .bind("w1", "u1")
        .run();

      const env = { DB: sqlite.db } as unknown as AppEnv;
      const db = kyselyDb(env) as unknown as Kysely<{
        widget: { id: string; userId: string };
      }>;

      const rows = await db
        .selectFrom("widget")
        .select("userId")
        .where("id", "=", "w1")
        .execute();

      expect(rows).toEqual([{ userId: "u1" }]);
    } finally {
      sqlite.close();
    }
  });
});
