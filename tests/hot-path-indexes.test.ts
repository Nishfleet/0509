import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * 0509#5755, audit §V26: five hot or scheduled statements full-scanned their
 * table because the column they filter on had no child index. This is the
 * static class gate: it reads migrations/ in order, keeps the indexes the chain
 * ends with, and fails when a registered statement has no index whose column
 * list starts with the columns the statement reads. It is red before 0026 and
 * green after, and it fails again when a later migration drops one of those
 * indexes.
 *
 * A new scheduled or request-path statement against one of these tables gets a
 * row here, with its source, so the gate covers the class and not just the five
 * found first. The same five claims are proven on the planner by
 * tests/integration/hot-path-indexes.integration.test.ts.
 */
interface HotPathStatement {
  readonly table: string;
  readonly columns: readonly string[];
  readonly source: string;
}

const HOT_PATH_STATEMENTS: readonly HotPathStatement[] = [
  {
    table: "onboarding_run",
    columns: ["workspace_id", "started_at"],
    source: "app/lib/workspace.server.ts:97",
  },
  {
    table: "signal",
    columns: ["watch_id", "kind"],
    source: "app/lib/data/signal.server.ts:109",
  },
  {
    table: "send_attempt",
    columns: ["digest_id", "attempted_at"],
    source: "workers/delivery/dlq-consumer.ts:54",
  },
  {
    table: "session",
    columns: ["expiresAt"],
    source: "app/lib/data/auth_expiry.server.ts:1",
  },
  {
    table: "digest",
    columns: ["status", "period_end"],
    source: "workers/delivery/sweeper.ts:20",
  },
];

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

const CHAIN = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"))
  .join("\n");

const INDEX_STATEMENT =
  /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(["`]?\w+["`]?)\s+ON\s+(["`]?\w+["`]?)\s*\(([^)]*)\)|DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(["`]?\w+["`]?)|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(["`]?\w+["`]?)/gi;

const unquote = (name: string): string => name.replace(/["`]/g, "");

function indexesAtEndOfChain(): Map<string, { table: string; columns: string[] }> {
  const live = new Map<string, { table: string; columns: string[] }>();
  for (const match of CHAIN.matchAll(INDEX_STATEMENT)) {
    const [statement, created, table, columnList, dropped, droppedTable] = match;
    if (created !== undefined && table !== undefined && columnList !== undefined) {
      live.set(unquote(created), {
        table: unquote(table),
        columns: columnList
          .split(",")
          .map((column) => unquote(column.trim().split(/\s+/)[0] ?? "")),
      });
    } else if (dropped !== undefined) {
      live.delete(unquote(dropped));
    } else if (droppedTable !== undefined) {
      for (const [name, index] of live) {
        if (index.table === unquote(droppedTable)) live.delete(name);
      }
    } else {
      throw new Error(`unparsed index statement: ${String(statement)}`);
    }
  }
  return live;
}

const live = indexesAtEndOfChain();

function covers(statement: HotPathStatement): boolean {
  return [...live.values()].some(
    (index) =>
      index.table === statement.table &&
      statement.columns.every((column, at) => index.columns[at] === column),
  );
}

describe("hot-path index coverage (0509#5755)", () => {
  it("gives every hot or scheduled statement an index starting with its columns", () => {
    const uncovered = HOT_PATH_STATEMENTS.filter((statement) => !covers(statement));
    expect(
      uncovered.map(
        (statement) =>
          `${statement.table}(${statement.columns.join(", ")}) from ${statement.source}`,
      ),
    ).toEqual([]);
  });
});
