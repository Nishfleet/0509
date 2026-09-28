import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * 0509#5755, audit §V26: five hot or scheduled statements full-scanned their
 * table because the column they filter on had no child index. This test reads
 * migrations/ as text, builds the column and index map the chain ends at, and
 * fails when a registered statement has no index whose column list starts with
 * the columns the statement reads. It is red on the pre-0026 chain and green
 * after it, and it fails again the moment a later migration drops one of those
 * indexes or a registry row is added without one.
 *
 * A new scheduled or request-path statement against one of these tables gets a
 * row here, with its source, so the gate covers the class and not just the five
 * that were found first.
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

interface IndexDefinition {
  readonly name: string;
  readonly columns: readonly string[];
}

interface Chain {
  readonly columns: Map<string, Set<string>>;
  readonly indexes: Map<string, IndexDefinition[]>;
}

function unquote(name: string): string {
  return name.replace(/^["'`]|["'`]$/g, "");
}

function matchingClose(sql: string, open: number): number {
  let depth = 0;
  for (let at = open; at < sql.length; at += 1) {
    if (sql[at] === "(") depth += 1;
    if (sql[at] === ")") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  throw new Error(`unbalanced parentheses in the migration chain at offset ${String(open)}`);
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] === "(") depth += 1;
    if (body[at] === ")") depth -= 1;
    if (body[at] === "," && depth === 0) {
      parts.push(body.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function parenthesisedColumns(text: string): string[] {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open === -1 || close === -1) return [];
  return splitTopLevel(text.slice(open + 1, close)).map((part) =>
    unquote(part.trim().split(/\s+/)[0] ?? ""),
  );
}

function parseChain(sql: string): Chain {
  const columns = new Map<string, Set<string>>();
  const indexes = new Map<string, IndexDefinition[]>();
  const addIndex = (table: string, name: string, cols: readonly string[]): void => {
    const kept = cols.filter((column) => column.length > 0);
    if (kept.length === 0) return;
    const forTable = indexes.get(table) ?? [];
    if (!forTable.some((index) => index.name === name)) {
      forTable.push({ name, columns: kept });
    }
    indexes.set(table, forTable);
  };
  const dropIndex = (name: string): void => {
    for (const [table, forTable] of indexes) {
      indexes.set(
        table,
        forTable.filter((index) => index.name !== name),
      );
    }
  };

  interface Event {
    readonly at: number;
    readonly apply: () => void;
  }
  const events: Event[] = [];

  for (const match of sql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(["`]?\w+["`]?)\s*(?=\()/gi,
  )) {
    const table = unquote(match[1]);
    const body = sql.slice(match.index + match[0].length + 1, matchingClose(sql, match.index + match[0].length));
    events.push({
      at: match.index,
      apply: () => {
        const kept = new Set<string>();
        for (const part of splitTopLevel(body)) {
          const head = part.trim();
          const constraint = head.match(/^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i);
          if (constraint !== null) {
            const kind = constraint[1].toUpperCase().replace(/\s+/g, " ");
            if (kind === "PRIMARY KEY" || kind === "UNIQUE") {
              const cols = parenthesisedColumns(head);
              addIndex(table, `constraint:${table}:${cols.join(",")}`, cols);
            }
            continue;
          }
          const column = head.match(/^(["`]?\w+["`]?)/);
          if (column !== null) kept.add(unquote(column[1]));
        }
        columns.set(table, kept);
      },
    });
  }

  for (const match of sql.matchAll(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(["`]?\w+["`]?)\s+ON\s+(["`]?\w+["`]?)\s*\(([^)]*)\)/gi,
  )) {
    const name = unquote(match[1]);
    const table = unquote(match[2]);
    const cols = splitTopLevel(match[3]).map((part) =>
      unquote(part.trim().split(/\s+/)[0] ?? ""),
    );
    events.push({ at: match.index, apply: () => { addIndex(table, name, cols); } });
  }

  for (const match of sql.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(["`]?\w+["`]?)/gi)) {
    const name = unquote(match[1]);
    events.push({ at: match.index, apply: () => { dropIndex(name); } });
  }

  for (const match of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(["`]?\w+["`]?)/gi)) {
    const table = unquote(match[1]);
    events.push({
      at: match.index,
      apply: () => {
        columns.delete(table);
        indexes.delete(table);
      },
    });
  }

  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+(["`]?\w+["`]?)\s+RENAME\s+TO\s+(["`]?\w+["`]?)/gi,
  )) {
    const from = unquote(match[1]);
    const to = unquote(match[2]);
    events.push({
      at: match.index,
      apply: () => {
        columns.set(to, columns.get(from) ?? new Set());
        indexes.set(to, indexes.get(from) ?? []);
        columns.delete(from);
        indexes.delete(from);
      },
    });
  }

  events.sort((left, right) => left.at - right.at);
  for (const event of events) event.apply();
  return { columns, indexes };
}

const chain = parseChain(
  readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"))
    .join("\n"),
);

describe("hot-path index coverage (0509#5755)", () => {
  it("names only tables and columns the migration chain creates", () => {
    const unknown: string[] = [];
    for (const statement of HOT_PATH_STATEMENTS) {
      const tableColumns = chain.columns.get(statement.table);
      if (tableColumns === undefined) {
        unknown.push(`${statement.table} (${statement.source})`);
        continue;
      }
      for (const column of statement.columns) {
        if (!tableColumns.has(column)) {
          unknown.push(`${statement.table}.${column} (${statement.source})`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("gives every hot or scheduled statement an index starting with its columns", () => {
    const uncovered = HOT_PATH_STATEMENTS.filter((statement) => {
      const forTable = chain.indexes.get(statement.table) ?? [];
      return !forTable.some((index) =>
        statement.columns.every((column, at) => index.columns[at] === column),
      );
    });
    expect(
      uncovered.map(
        (statement) =>
          `${statement.table}(${statement.columns.join(", ")}) from ${statement.source}`,
      ),
    ).toEqual([]);
  });
});
