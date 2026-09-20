import { CamelCasePlugin, Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

import { chunkForBoundParams, D1_MAX_BOUND_PARAMS } from "~/lib/d1-chunk.server";
import type { Database } from "~/lib/data/d1-schema.server";
import type { AppEnv } from "~/lib/env.server";

/**
 * Shared D1 helpers plus the Kysely instance new data-layer code queries
 * through (#3783). All IN-list expansion must go through `queryIn` /
 * `chunkForBoundParams` so statements stay under D1's 100 bound-parameter cap.
 */

export function ensureDb(env: AppEnv) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  return env.DB;
}

/**
 * Typed query builder over the D1 `DB` binding. `CamelCasePlugin` maps the
 * camelCase `Database` schema onto the snake_case columns migrations create
 * and maps result rows back. A fresh instance per call is intentional:
 * Kysely holds no open connection and `env` is request-scoped.
 *
 * Existing callers keep the raw helpers below; each `data/` directory
 * migrates to `kyselyDb` in its own PR.
 */
export function kyselyDb(env: AppEnv) {
  return new Kysely<Database>({
    dialect: new D1Dialect({ database: ensureDb(env) }),
    plugins: [new CamelCasePlugin()],
  });
}

export async function queryAll<T>(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const result = await ensureDb(env).prepare(sql).bind(...bindings).all<T>();
  return result.results ?? [];
}

export async function queryOne<T>(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const rows = await queryAll<T>(env, sql, ...bindings);
  return rows[0] ?? null;
}

export async function execute(env: AppEnv, sql: string, ...bindings: unknown[]) {
  return ensureDb(env).prepare(sql).bind(...bindings).run();
}

export type QueryInOptions = {
  /** Build the full SQL, inserting the `?, ?, ...` placeholder list for this chunk. */
  buildSql: (placeholders: string) => string;
  /** Values expanded into the IN list (chunked automatically). */
  values: readonly unknown[];
  /** Bindings placed before the IN list in each statement. */
  prefix?: readonly unknown[];
  /** Bindings placed after the IN list in each statement. */
  suffix?: readonly unknown[];
  /**
   * Max IN-list values per statement. Defaults to
   * `D1_MAX_BOUND_PARAMS - prefix.length - suffix.length` so total bound
   * params stay under the D1 cap.
   */
  chunkSize?: number;
};

/**
 * Run a SELECT that expands an arbitrary-length value list into `IN (?, ...)`,
 * chunking via `chunkForBoundParams` so each statement stays under D1's limit.
 * Returns `[]` when `values` is empty (no query is issued).
 */
export async function queryIn<T>(env: AppEnv, options: QueryInOptions): Promise<T[]> {
  const values = options.values;
  if (values.length === 0) {
    return [];
  }

  const prefix = options.prefix ?? [];
  const suffix = options.suffix ?? [];
  const reserved = prefix.length + suffix.length;
  const chunkSize =
    options.chunkSize ?? Math.max(1, D1_MAX_BOUND_PARAMS - reserved);

  if (reserved + chunkSize > D1_MAX_BOUND_PARAMS) {
    throw new Error(
      `queryIn chunkSize ${chunkSize} plus ${reserved} fixed bindings exceeds D1_MAX_BOUND_PARAMS (${D1_MAX_BOUND_PARAMS})`,
    );
  }

  const chunkedRows = await Promise.all(
    chunkForBoundParams(values, chunkSize).map((chunk) => {
      const placeholders = chunk.map(() => "?").join(", ");
      return queryAll<T>(env, options.buildSql(placeholders), ...prefix, ...chunk, ...suffix);
    }),
  );

  return chunkedRows.flat();
}
