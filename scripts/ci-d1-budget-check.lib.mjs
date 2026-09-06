#!/usr/bin/env node
/**
 * D1 query budget trip-wire (issue #1731).
 *
 * Cloudflare enforces D1 free-tier daily limits of 5M rows read and 100K rows
 * written per day. This check estimates the app's daily D1 footprint and fails
 * non-zero when the estimate exceeds a configured fraction (default 10%) of
 * the daily limit, so a query or canary that would burn the free tier is
 * caught in CI instead of by a Cloudflare enforcement email.
 *
 * Method:
 *  1. Apply the repo's real `migrations/*.sql` to an in-memory SQLite database
 *     (node:sqlite — D1 is SQLite, so EXPLAIN QUERY PLAN output is
 *     representative for scan-vs-index classification).
 *  2. For each hot-path query in `scripts/d1-budget-queries.json`, run
 *     `EXPLAIN QUERY PLAN` and estimate rows touched per call:
 *       - `SCAN <table>` contributes the table's estimated row count.
 *       - `SEARCH <table>` contributes `rowsPerIndexedSearch` (per-query
 *         override allowed), multiplied by the accumulated rows of preceding
 *         plan nodes — SQLite joins are nested loops, so a later SEARCH runs
 *         once per row produced so far (worst-case bound).
 *       - Plan pseudo-nodes (`MULTI-INDEX OR`, `INDEX n`, `USE TEMP B-TREE`,
 *         `SCAN CONSTANT ROW`, `* SUBQUERY *`, `MATERIALIZE`, `COMPOUND`)
 *         contribute zero rows and do not compound the multiplier.
 *     A SCAN/SEARCH of a table missing from `scripts/d1-budget-estimates.json`
 *     is a hard error — the estimate file must stay complete to stay honest.
 *  3. Writes: INSERT/REPLACE default to `writesPerCall` (default 1);
 *     UPDATE/DELETE default to the estimated rows touched (rows matched).
 *  4. Canary budget declarations: every `scripts/*canary*.mjs` entrypoint
 *     (excluding `*.lib.mjs`) and every `.github/workflows/*canary*.yml` must
 *     carry `d1-budget: reads=<n> writes=<n> runs_per_day=<n>`. Missing or
 *     over-allowance declarations fail the check.
 *  5. Daily totals = sum(callsPerDay * rowsPerCall) for queries plus
 *     sum(reads * runs_per_day) for canaries. Fail when either total exceeds
 *     `tripFraction` of the daily limit.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const ESTIMATES_PATH = "scripts/d1-budget-estimates.json";
export const QUERIES_PATH = "scripts/d1-budget-queries.json";

const CANARY_BUDGET_PATTERN =
  /d1-budget:\s*reads=(\d+)\s+writes=(\d+)(?:\s+runs_per_day=(\d+))?/;
const PLAN_ACCESS_PATTERN = /^(SCAN|SEARCH)\s+(\S+)/;
const PLAN_PSEUDO_TARGETS = new Set(["CONSTANT", "SUBQUERY", "MATERIALIZE"]);
const WRITE_VERBS = new Set(["INSERT", "UPDATE", "DELETE", "REPLACE"]);
const FROM_ALIAS_PATTERN =
  /(?:\bFROM|\bJOIN)\s+([A-Za-z_]\w*)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi;
const SQL_KEYWORDS = new Set([
  "WHERE", "ON", "ORDER", "GROUP", "LEFT", "RIGHT", "INNER", "OUTER", "FULL",
  "CROSS", "JOIN", "LIMIT", "USING", "AS", "SET", "VALUES", "SELECT", "UNION",
  "HAVING", "AND", "OR", "NOT", "EXISTS", "CASE", "WHEN", "INDEXED", "NATURAL",
]);

/** @param {DatabaseSync} db @param {string} migrationsDir */
export function applyMigrationsToDatabase(db, migrationsDir) {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no migrations found in ${migrationsDir}`);
  }
  for (const file of files) {
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return files.length;
}

/** @param {unknown} value @param {string} label @returns {number} */
function requireNonNegativeInt(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** @param {unknown} raw @returns {{ tables: Record<string, number>, dailyLimits: { rowsRead: number, rowsWritten: number }, tripFraction: number, rowsPerIndexedSearch: number, subqueryRows: number, canaryMaxReadsPerRun: number, canaryMaxWritesPerRun: number }} */
export function parseEstimates(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("d1-budget-estimates.json must be an object");
  }
  const config = /** @type {Record<string, unknown>} */ (raw);
  const tables = /** @type {Record<string, unknown>} */ (config.tables);
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) {
    throw new Error("d1-budget-estimates.json: missing tables object");
  }
  /** @type {Record<string, number>} */
  const parsedTables = {};
  for (const [name, rows] of Object.entries(tables)) {
    parsedTables[name] = requireNonNegativeInt(rows, `tables.${name}`);
  }
  const limits = /** @type {Record<string, unknown>} */ (config.dailyLimits ?? {});
  return {
    tables: parsedTables,
    dailyLimits: {
      rowsRead: requireNonNegativeInt(limits.rowsRead ?? 5_000_000, "dailyLimits.rowsRead"),
      rowsWritten: requireNonNegativeInt(limits.rowsWritten ?? 100_000, "dailyLimits.rowsWritten"),
    },
    tripFraction: typeof config.tripFraction === "number" && config.tripFraction > 0 && config.tripFraction <= 1
      ? config.tripFraction
      : 0.1,
    rowsPerIndexedSearch: requireNonNegativeInt(config.rowsPerIndexedSearch ?? 25, "rowsPerIndexedSearch"),
    subqueryRows: requireNonNegativeInt(config.subqueryRows ?? 100, "subqueryRows"),
    canaryMaxReadsPerRun: requireNonNegativeInt(config.canaryMaxReadsPerRun ?? 100_000, "canaryMaxReadsPerRun"),
    canaryMaxWritesPerRun: requireNonNegativeInt(config.canaryMaxWritesPerRun ?? 5_000, "canaryMaxWritesPerRun"),
  };
}

/** @param {unknown} raw @returns {Array<{ name: string, sql: string, callsPerDay: number, writesPerCall?: number, rowsPerIndexedSearch?: number }>} */
export function parseQueries(raw) {
  const list = Array.isArray(raw) ? raw : /** @type {any} */ (raw)?.queries;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("d1-budget-queries.json must be a non-empty array or { queries: [...] }");
  }
  const seen = new Set();
  return list.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`query entry ${index} must be an object`);
    }
    const q = /** @type {Record<string, unknown>} */ (entry);
    if (typeof q.name !== "string" || q.name.length === 0) {
      throw new Error(`query entry ${index} missing name`);
    }
    if (seen.has(q.name)) {
      throw new Error(`duplicate query name ${q.name}`);
    }
    seen.add(q.name);
    if (typeof q.sql !== "string" || q.sql.trim().length === 0) {
      throw new Error(`query ${q.name} missing sql`);
    }
    /** @type {{ name: string, sql: string, callsPerDay: number, writesPerCall?: number, rowsPerIndexedSearch?: number }} */
    const parsed = {
      name: q.name,
      sql: q.sql.trim(),
      callsPerDay: requireNonNegativeInt(q.callsPerDay, `queries.${q.name}.callsPerDay`),
    };
    if (q.writesPerCall !== undefined) {
      parsed.writesPerCall = requireNonNegativeInt(q.writesPerCall, `queries.${q.name}.writesPerCall`);
    }
    if (q.rowsPerIndexedSearch !== undefined) {
      parsed.rowsPerIndexedSearch = requireNonNegativeInt(q.rowsPerIndexedSearch, `queries.${q.name}.rowsPerIndexedSearch`);
    }
    return parsed;
  });
}

/**
 * Index metadata for the scratch schema: name -> { unique, columnCount }.
 * Used to tell a point lookup (equality on every column of a unique index,
 * or an INTEGER PRIMARY KEY) from a range/index scan.
 * @param {DatabaseSync} db
 * @returns {Map<string, { unique: boolean, columnCount: number }>}
 */
function indexMetadata(db) {
  const meta = new Map();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String(/** @type {{ name?: unknown }} */ (row).name));
  /** @param {unknown} value @returns {string} */
  const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
  for (const table of tables) {
    const indexes = db
      .prepare(`SELECT name, "unique" AS isUnique FROM pragma_index_list(${sqlString(table)})`)
      .all();
    for (const index of indexes) {
      const name = String(/** @type {{ name?: unknown }} */ (index).name);
      const isUnique = Number(/** @type {{ isUnique?: unknown }} */ (index).isUnique) === 1;
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM pragma_index_info(${sqlString(name)})`)
        .get();
      const columnCount = Number(/** @type {{ n?: unknown }} */ (row)?.n ?? 0);
      meta.set(name, { unique: isUnique, columnCount });
    }
  }
  return meta;
}

const SEARCH_USING_PATTERN =
  /USING\s+(?:COVERING\s+)?(?:INDEX\s+(\S+)|INTEGER\s+PRIMARY\s+KEY)(?:\s*\(([^)]*)\))?/;

/**
 * Count `col = ?` equality terms in an EXPLAIN QUERY PLAN constraint list.
 * @param {string | undefined} constraints
 */
function equalityTermCount(constraints) {
  if (!constraints) return 0;
  return (constraints.match(/(?<![<>=!])=(?![>=])/g) ?? []).length;
}

/**
 * Builds a FROM/JOIN alias -> table map so plan nodes that report an alias
 * (`SEARCH wr USING INDEX ...`) resolve to the real table name.
 * @param {string} sql @returns {Record<string, string>}
 */
function tableAliases(sql) {
  /** @type {Record<string, string>} */
  const aliases = {};
  for (const match of sql.matchAll(FROM_ALIAS_PATTERN)) {
    const table = match[1];
    const alias = match[2];
    if (alias && !SQL_KEYWORDS.has(alias.toUpperCase()) && alias !== table) {
      aliases[alias] = table;
    }
  }
  return aliases;
}

/**
 * @param {DatabaseSync} db
 * @param {{ name: string, sql: string, callsPerDay: number, writesPerCall?: number, rowsPerIndexedSearch?: number }} query
 * @param {ReturnType<typeof parseEstimates>} estimates
 * @returns {{ readsPerCall: number, writesPerCall: number, plan: string[], accessNodes: Array<{ kind: string, table: string, rows: number }> }}
 */
export function estimateQueryRows(db, query, estimates) {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all();
  const planNodes = rows.map((row) => {
    const node = /** @type {{ id?: unknown, parent?: unknown, detail?: unknown }} */ (row);
    return { id: Number(node.id), parent: Number(node.parent), detail: String(node.detail ?? "") };
  });
  const plan = planNodes.map((node) => node.detail);
  const children = new Map();
  for (const node of planNodes) {
    const siblings = children.get(node.parent) ?? [];
    siblings.push(node);
    children.set(node.parent, siblings);
  }
  const aliases = tableAliases(query.sql);
  const searchRows = query.rowsPerIndexedSearch ?? estimates.rowsPerIndexedSearch;
  const indexes = indexMetadata(db);
  /** @type {Array<{ kind: string, table: string, rows: number }>} */
  const accessNodes = [];
  let readsPerCall = 0;

  /**
   * Rows a SEARCH node reads and emits per execution: a point lookup
   * (equality on every column of a unique index, or INTEGER PRIMARY KEY)
   * costs 1 row and emits at most 1; any other index access is a range scan
   * charged at the query's rowsPerIndexedSearch.
   * @param {string} detail
   */
  function searchRowsFor(detail) {
    const using = SEARCH_USING_PATTERN.exec(detail);
    if (!using) return searchRows;
    const [, indexName, constraints] = using;
    if (!indexName) return 1; // INTEGER PRIMARY KEY point lookup
    const meta = indexes.get(indexName);
    if (!meta) return searchRows;
    if (meta.unique && meta.columnCount > 0 && equalityTermCount(constraints) >= meta.columnCount) {
      return 1;
    }
    return searchRows;
  }

  /**
   * Returns the estimated rows this node produces so a parent loop can
   * multiply later siblings by it.
   * @param {{ id: number, detail: string }} node
   * @param {number} execCount - how many times this node's subtree executes
   */
  function walkNode(node, execCount) {
    const detail = node.detail;
    const match = PLAN_ACCESS_PATTERN.exec(detail);
    let ownRows = 1;
    if (match) {
      const [, kind, target] = match;
      if (target === "CONSTANT") {
        // SCAN CONSTANT ROW reads nothing and emits one row.
        ownRows = 1;
      } else if (PLAN_PSEUDO_TARGETS.has(target)) {
        // Materialized subquery: bounded fan-out only; the subquery's inner
        // table nodes are still counted where they appear in the plan.
        ownRows = estimates.subqueryRows;
        readsPerCall += estimates.subqueryRows * execCount;
        accessNodes.push({ kind, table: target, rows: estimates.subqueryRows * execCount });
      } else {
        const table = target in estimates.tables ? target : aliases[target];
        const tableRows = table !== undefined ? estimates.tables[table] : undefined;
        if (table === undefined || tableRows === undefined) {
          throw new Error(
            `query ${query.name}: plan touches table "${target}" with no estimate in ${ESTIMATES_PATH} (add a rows estimate so the budget stays honest)`,
          );
        }
        ownRows = kind === "SCAN" ? tableRows : searchRowsFor(detail);
        readsPerCall += ownRows * execCount;
        accessNodes.push({ kind, table, rows: ownRows * execCount });
      }
    }
    const kids = children.get(node.id) ?? [];
    // MULTI-INDEX OR children are alternative branches, not nested loops:
    // each INDEX arm runs execCount times; the union of their outputs is the
    // row count this node feeds to the enclosing loop.
    if (detail.startsWith("MULTI-INDEX OR") || /^INDEX \d+/.test(detail)) {
      let unionRows = 0;
      for (const kid of kids) unionRows += walkNode(kid, execCount);
      return Math.max(unionRows, 1);
    }
    let childExec = execCount;
    for (const kid of kids) {
      childExec *= Math.max(walkNode(kid, childExec), 1);
    }
    return ownRows;
  }

  let exec = 1;
  for (const node of children.get(0) ?? []) {
    exec *= Math.max(walkNode(node, exec), 1);
  }

  const verb = query.sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase() ?? "";
  let writesPerCall = 0;
  if (WRITE_VERBS.has(verb)) {
    writesPerCall =
      query.writesPerCall ?? (verb === "INSERT" || verb === "REPLACE" ? 1 : readsPerCall);
  }
  return { readsPerCall, writesPerCall, plan, accessNodes };
}

/**
 * @param {string} root - repo root
 * @returns {{ files: string[], declarations: Array<{ file: string, reads: number, writes: number, runsPerDay: number }>, errors: string[] }}
 */
export function scanCanaryBudgets(root) {
  const scriptsDir = join(root, "scripts");
  const workflowsDir = join(root, ".github", "workflows");
  const files = [
    ...readdirSync(scriptsDir)
      .filter((name) => name.includes("canary") && name.endsWith(".mjs") && !name.endsWith(".lib.mjs"))
      .map((name) => join("scripts", name)),
    ...readdirSync(workflowsDir)
      .filter((name) => name.includes("canary") && name.endsWith(".yml"))
      .map((name) => join(".github", "workflows", name)),
  ].sort();
  const declarations = [];
  const errors = [];
  for (const file of files) {
    const content = readFileSync(join(root, file), "utf8");
    const match = CANARY_BUDGET_PATTERN.exec(content);
    if (!match) {
      errors.push(
        `${file}: missing 'd1-budget: reads=<n> writes=<n> runs_per_day=<n>' declaration — every canary must declare the D1 rows it consumes per run`,
      );
      continue;
    }
    declarations.push({
      file,
      reads: Number(match[1]),
      writes: Number(match[2]),
      runsPerDay: match[3] === undefined ? 1 : Number(match[3]),
    });
  }
  return { files, declarations, errors };
}

/**
 * Runs the whole budget check against a repo root.
 * @param {string} root
 * @returns {{ ok: boolean, errors: string[], lines: string[], totals: { readsPerDay: number, writesPerDay: number, readTrip: number, writeTrip: number } }}
 */
export function runBudgetCheck(root) {
  const errors = [];
  const lines = [];
  const estimates = parseEstimates(
    JSON.parse(readFileSync(join(root, ESTIMATES_PATH), "utf8")),
  );
  const queries = parseQueries(
    JSON.parse(readFileSync(join(root, QUERIES_PATH), "utf8")),
  );

  const db = new DatabaseSync(":memory:");
  try {
    const applied = applyMigrationsToDatabase(db, join(root, "migrations"));
    lines.push(`d1-budget-check: applied ${applied} migrations to scratch SQLite schema`);
  } catch (error) {
    errors.push(`migration apply failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let readsPerDay = 0;
  let writesPerDay = 0;
  for (const query of queries) {
    try {
      const estimate = estimateQueryRows(db, query, estimates);
      const dailyReads = estimate.readsPerCall * query.callsPerDay;
      const dailyWrites = estimate.writesPerCall * query.callsPerDay;
      readsPerDay += dailyReads;
      writesPerDay += dailyWrites;
      const shape = estimate.accessNodes
        .map((node) => `${node.kind} ${node.table}=${node.rows}`)
        .join(" + ");
      lines.push(
        `d1-budget-check: query ${query.name} calls/day=${query.callsPerDay} reads/call=${estimate.readsPerCall} writes/call=${estimate.writesPerCall} -> reads/day=${dailyReads} writes/day=${dailyWrites} (${shape || "no table access"})`,
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const canaries = scanCanaryBudgets(root);
  errors.push(...canaries.errors);
  for (const declaration of canaries.declarations) {
    if (declaration.reads > estimates.canaryMaxReadsPerRun) {
      errors.push(
        `${declaration.file}: declared reads=${declaration.reads} exceeds canaryMaxReadsPerRun=${estimates.canaryMaxReadsPerRun}`,
      );
    }
    if (declaration.writes > estimates.canaryMaxWritesPerRun) {
      errors.push(
        `${declaration.file}: declared writes=${declaration.writes} exceeds canaryMaxWritesPerRun=${estimates.canaryMaxWritesPerRun}`,
      );
    }
    const dailyReads = declaration.reads * declaration.runsPerDay;
    const dailyWrites = declaration.writes * declaration.runsPerDay;
    readsPerDay += dailyReads;
    writesPerDay += dailyWrites;
    lines.push(
      `d1-budget-check: canary ${declaration.file} runs/day=${declaration.runsPerDay} reads/run=${declaration.reads} writes/run=${declaration.writes} -> reads/day=${dailyReads} writes/day=${dailyWrites}`,
    );
  }

  const readTrip = Math.floor(estimates.dailyLimits.rowsRead * estimates.tripFraction);
  const writeTrip = Math.floor(estimates.dailyLimits.rowsWritten * estimates.tripFraction);
  if (readsPerDay > readTrip) {
    errors.push(
      `estimated daily rows read ${readsPerDay} exceeds ${estimates.tripFraction * 100}% trip threshold ${readTrip} (daily limit ${estimates.dailyLimits.rowsRead})`,
    );
  }
  if (writesPerDay > writeTrip) {
    errors.push(
      `estimated daily rows written ${writesPerDay} exceeds ${estimates.tripFraction * 100}% trip threshold ${writeTrip} (daily limit ${estimates.dailyLimits.rowsWritten})`,
    );
  }
  lines.push(
    `d1-budget-check: totals reads/day=${readsPerDay} (trip ${readTrip}) writes/day=${writesPerDay} (trip ${writeTrip})`,
  );
  return { ok: errors.length === 0, errors, lines, totals: { readsPerDay, writesPerDay, readTrip, writeTrip } };
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));

if (isMain) {
  const root = process.env.D1_BUDGET_ROOT ?? process.cwd();
  try {
    const result = runBudgetCheck(root);
    for (const line of result.lines) console.log(line);
    for (const error of result.errors) console.error(`d1-budget-check: ERROR ${error}`);
    if (!result.ok) {
      console.error("d1-budget-check: FAIL");
      process.exit(1);
    }
    console.log("d1-budget-check: PASS");
  } catch (error) {
    console.error(`d1-budget-check: FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
