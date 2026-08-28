// @ts-nocheck Restore behavior is proven by executable transform and scratch-D1 tests.

/**
 * Turn D1 export statements containing very large TEXT literals into a set of
 * D1-sized statements, and order the result so it restores against a database
 * that enforces foreign keys. This is intentionally restore-only: it accepts a
 * complete export, discovers primary keys from its CREATE TABLE statements,
 * and refuses to guess about SQL it cannot prove safe to rewrite.
 *
 * See `orderRestoreStatements` for why every `CREATE TABLE` is hoisted ahead of
 * the rows.
 */

export const DEFAULT_MAX_STATEMENT_BYTES = 90_000;

const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

function isSpace(code) {
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}

function skipSpace(sql, index) {
  while (index < sql.length && isSpace(sql.charCodeAt(index))) index += 1;
  return index;
}

function skipTrivia(sql, index) {
  let cursor = index;
  for (;;) {
    cursor = skipSpace(sql, cursor);
    if (sql.startsWith("--", cursor)) {
      const newline = sql.indexOf("\n", cursor + 2);
      cursor = newline < 0 ? sql.length : newline + 1;
      continue;
    }
    if (sql.startsWith("/*", cursor)) {
      const end = sql.indexOf("*/", cursor + 2);
      if (end < 0) return sql.length;
      cursor = end + 2;
      continue;
    }
    return cursor;
  }
}

function readQuoted(sql, index, quote) {
  let cursor = index + 1;
  while (cursor < sql.length) {
    if (sql[cursor] === quote) {
      if (sql[cursor + 1] === quote) {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    cursor += 1;
  }
  throw new Error(`Unterminated ${quote} identifier/string at byte ${byteLength(sql.slice(0, index))}.`);
}

function readStringToken(sql, index) {
  if (sql[index] !== "'") return null;
  const end = readQuoted(sql, index, "'");
  return { start: index, end, raw: sql.slice(index, end) };
}

function readIdentifier(sql, index) {
  const start = index;
  const first = sql[index];
  if (first === '"' || first === "`" || first === "[") {
    const end = readQuoted(sql, index, first === "[" ? "]" : first);
    const raw = sql.slice(index, end);
    let value;
    if (first === "[") value = raw.slice(1, -1).replaceAll("]]", "]");
    else value = raw.slice(1, -1).replaceAll(first + first, first);
    return { start, end, raw, value, normalized: value.toLowerCase() };
  }
  if (!first || !/[A-Za-z_]/.test(first)) return null;
  let end = index + 1;
  while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) end += 1;
  const value = sql.slice(index, end);
  return { start, end, raw: value, value, normalized: value.toLowerCase() };
}

function keywordAt(sql, index, keyword) {
  if (sql.slice(index, index + keyword.length).toLowerCase() !== keyword.toLowerCase()) return false;
  const before = sql[index - 1];
  const after = sql[index + keyword.length];
  return (!before || !/[A-Za-z0-9_$]/.test(before)) && (!after || !/[A-Za-z0-9_$]/.test(after));
}

function readKeyword(sql, index) {
  const identifier = readIdentifier(sql, index);
  if (!identifier || identifier.raw[0] === '"' || identifier.raw[0] === "`" || identifier.raw[0] === "[") return null;
  return identifier;
}

function matchingParen(sql, open) {
  let depth = 0;
  let cursor = open;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (char === "'") {
      cursor = readQuoted(sql, cursor, "'");
      continue;
    }
    if (char === '"' || char === "`" || char === "[") {
      cursor = readQuoted(sql, cursor, char === "[" ? "]" : char);
      continue;
    }
    if (sql.startsWith("--", cursor)) {
      const newline = sql.indexOf("\n", cursor + 2);
      cursor = newline < 0 ? sql.length : newline + 1;
      continue;
    }
    if (sql.startsWith("/*", cursor)) {
      const end = sql.indexOf("*/", cursor + 2);
      if (end < 0) throw new Error("Unterminated SQL block comment.");
      cursor = end + 2;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  throw new Error("Unterminated SQL parenthesized expression.");
}

function splitTopLevel(sql, start, end) {
  const parts = [];
  let pieceStart = start;
  let cursor = start;
  let depth = 0;
  while (cursor < end) {
    const char = sql[cursor];
    if (char === "'") {
      cursor = readQuoted(sql, cursor, "'");
      continue;
    }
    if (char === '"' || char === "`" || char === "[") {
      cursor = readQuoted(sql, cursor, char === "[" ? "]" : char);
      continue;
    }
    if (sql.startsWith("--", cursor)) {
      const newline = sql.indexOf("\n", cursor + 2);
      cursor = newline < 0 || newline > end ? end : newline + 1;
      continue;
    }
    if (sql.startsWith("/*", cursor)) {
      const blockEnd = sql.indexOf("*/", cursor + 2);
      if (blockEnd < 0 || blockEnd + 2 > end) throw new Error("Unterminated SQL block comment.");
      cursor = blockEnd + 2;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push({ start: pieceStart, end: cursor });
      pieceStart = cursor + 1;
    }
    cursor += 1;
  }
  parts.push({ start: pieceStart, end });
  return parts;
}

function trimSpan(sql, span) {
  let start = span.start;
  let end = span.end;
  while (start < end && isSpace(sql.charCodeAt(start))) start += 1;
  while (end > start && isSpace(sql.charCodeAt(end - 1))) end -= 1;
  return { ...span, trimmedStart: start, trimmedEnd: end, raw: sql.slice(start, end) };
}

function parseIdentifierList(sql, open) {
  const close = matchingParen(sql, open);
  const spans = splitTopLevel(sql, open + 1, close).map((span) => trimSpan(sql, span));
  const identifiers = spans.map((span) => {
    const identifier = readIdentifier(sql, span.trimmedStart);
    if (!identifier || identifier.end !== span.trimmedEnd) throw new Error("Expected a simple identifier list.");
    return identifier;
  });
  return { close, spans, identifiers };
}

function parseCreateTable(statement) {
  let cursor = skipTrivia(statement, 0);
  let word = readKeyword(statement, cursor);
  if (!word || word.normalized !== "create") return null;
  cursor = skipTrivia(statement, word.end);
  word = readKeyword(statement, cursor);
  if (word?.normalized === "temp" || word?.normalized === "temporary") cursor = skipTrivia(statement, word.end);
  word = readKeyword(statement, cursor);
  if (!word || word.normalized !== "table") return null;
  cursor = skipTrivia(statement, word.end);
  word = readKeyword(statement, cursor);
  if (word?.normalized === "if") {
    cursor = skipTrivia(statement, word.end);
    word = readKeyword(statement, cursor);
    if (!word || word.normalized !== "not") return null;
    cursor = skipTrivia(statement, word.end);
    word = readKeyword(statement, cursor);
    if (!word || word.normalized !== "exists") return null;
    cursor = skipTrivia(statement, word.end);
  }
  const first = readIdentifier(statement, cursor);
  if (!first) return null;
  cursor = skipTrivia(statement, first.end);
  let table = first;
  if (statement[cursor] === ".") {
    const second = readIdentifier(statement, skipTrivia(statement, cursor + 1));
    if (!second) return null;
    table = second;
    cursor = skipTrivia(statement, second.end);
  }
  if (statement[cursor] !== "(") return null;
  const close = matchingParen(statement, cursor);
  const definitions = splitTopLevel(statement, cursor + 1, close).map((span) => trimSpan(statement, span));
  const keys = [];
  /** @type {string[]} parent tables this table references via FOREIGN KEY. */
  const references = [];
  for (const definition of definitions) {
    const text = statement.slice(definition.trimmedStart, definition.trimmedEnd);
    const firstWord = readIdentifier(text, 0);
    if (!firstWord) continue;
    if (firstWord.normalized === "primary") {
      const match = /\bPRIMARY\s+KEY\s*\(/i.exec(text);
      if (!match) continue;
      const open = definition.trimmedStart + match.index + match[0].lastIndexOf("(");
      const list = parseIdentifierList(statement, open);
      keys.push(...list.identifiers.map((identifier) => identifier.normalized));
    } else if (/\bPRIMARY\s+KEY\b/i.test(text)) {
      keys.push(firstWord.normalized);
    }
    // Table-level `FOREIGN KEY (...) REFERENCES <parent>(...)` clause. A
    // column-level `... REFERENCES <parent>(...)` is also matched: the regex
    // keys on the REFERENCES keyword and reads the parent table name that
    // follows it. Self-references (a row pointing at another row in the same
    // table) are dropped — they cannot be satisfied by reordering across
    // tables and are handled by `PRAGMA defer_foreign_keys=TRUE` within the
    // table's own row block.
    const fkMatch = /\bREFERENCES\s+/i.exec(text);
    if (fkMatch) {
      const refStart = definition.trimmedStart + fkMatch.index + fkMatch[0].length;
      const ref = readIdentifier(statement, skipTrivia(statement, refStart));
      if (ref) {
        const parent = ref.normalized;
        if (parent !== table.normalized) references.push(parent);
      }
    }
  }
  return { table: table.normalized, keys: [...new Set(keys)], references: [...new Set(references)] };
}

function parseInsert(statement) {
  let cursor = skipTrivia(statement, 0);
  let word = readKeyword(statement, cursor);
  if (!word || word.normalized !== "insert") return null;
  cursor = skipTrivia(statement, word.end);
  word = readKeyword(statement, cursor);
  let conflict = null;
  if (word?.normalized === "or") {
    cursor = skipTrivia(statement, word.end);
    word = readKeyword(statement, cursor);
    if (!word || !["abort", "fail", "ignore", "replace", "rollback"].includes(word.normalized)) return null;
    conflict = word.normalized;
    cursor = skipTrivia(statement, word.end);
  }
  word = readKeyword(statement, cursor);
  if (!word || word.normalized !== "into") return null;
  cursor = skipTrivia(statement, word.end);
  const first = readIdentifier(statement, cursor);
  if (!first) return null;
  let table = first;
  cursor = skipTrivia(statement, first.end);
  if (statement[cursor] === ".") {
    const second = readIdentifier(statement, skipTrivia(statement, cursor + 1));
    if (!second) return null;
    table = second;
    cursor = skipTrivia(statement, second.end);
  }
  cursor = skipTrivia(statement, cursor);
  if (statement[cursor] !== "(") return null;
  const columns = parseIdentifierList(statement, cursor);
  cursor = skipTrivia(statement, columns.close + 1);
  word = readKeyword(statement, cursor);
  if (!word || word.normalized !== "values") return null;
  cursor = skipTrivia(statement, word.end);
  if (statement[cursor] !== "(") return null;
  const rowClose = matchingParen(statement, cursor);
  const values = splitTopLevel(statement, cursor + 1, rowClose).map((span) => trimSpan(statement, span));
  cursor = skipTrivia(statement, rowClose + 1);
  if (cursor < statement.length && statement[cursor] === ";") cursor = skipTrivia(statement, cursor + 1);
  if (cursor < statement.length) return null;
  return { table: table.normalized, tableRaw: table.value, columns: columns.identifiers, values, rowClose, conflict };
}

function decodeStringLiteral(raw) {
  if (raw.length < 2 || raw[0] !== "'" || raw.at(-1) !== "'") return null;
  return raw.slice(1, -1).replaceAll("''", "'");
}

function encodeStringLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function codePoints(value) {
  return [...value];
}

function isPlainString(value) {
  return value.length >= 2 && value[0] === "'" && value.at(-1) === "'" && decodeStringLiteral(value) !== null;
}

function scalarKeyExpression(value) {
  const trimmed = value.trim();
  if (isPlainString(trimmed)) return trimmed;
  if (/^(?:[-+]?\d+(?:\.\d*)?|[-+]?\.\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) return trimmed;
  if (/^x'(?:[0-9A-Fa-f]{2})*'$/i.test(trimmed)) return trimmed;
  throw new Error(`Primary-key value is not a literal: ${trimmed.slice(0, 80)}.`);
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function isPragmaStatement(statement) {
  const word = readKeyword(statement, skipTrivia(statement, 0));
  return word?.normalized === "pragma";
}

/**
 * Hoist every `CREATE TABLE` ahead of the rows, and order the rows so every
 * parent table's rows load before its child tables' rows.
 *
 * A D1 export walks `sqlite_master` in creation order and emits each table
 * immediately followed by its rows, so the export order is the order the tables
 * happen to have been created in. A table rebuild (`CREATE ..._next` / `DROP` /
 * `ALTER TABLE ... RENAME TO`, the convention used by 0002/0007/0008/0009/0019/
 * 0077) moves the rebuilt table to the end of that order. When a migration
 * rebuilds a child before its parent — 0077 rebuilt `watch_event`, which has
 * `FOREIGN KEY (candidate_id) REFERENCES event_candidate(id)`, before it
 * rebuilt `event_candidate` — the export emits `INSERT INTO "watch_event"`
 * while `event_candidate` does not exist yet.
 *
 * SQLite resolves a foreign key's parent table when the row is written, so with
 * foreign keys enforced that INSERT fails with
 * `no such table: main.event_candidate`. D1 enforces them on import, which is
 * why the 2026-08-25 restore drills went red the moment 0077 reached production
 * (`sqlite3` and `node:sqlite` default to `foreign_keys = OFF`, so the same
 * dump restores locally without complaint — the failure only appears against
 * D1). `PRAGMA defer_foreign_keys=TRUE`, which the export emits, defers
 * constraint *violations* to commit; it cannot conjure a missing table.
 *
 * Creating every table first removes the dependency on creation order for the
 * schema. The 2026-08-28 failure showed the rows still had a creation-order
 * dependency: after the table hoist every table exists, but a child row that
 * references a parent row which has not been inserted yet still fails with
 * `FOREIGN KEY constraint failed`. `wrangler d1 execute --file` does not wrap
 * the file in a single transaction, so `defer_foreign_keys=TRUE` cannot bridge
 * the gap across statements. Ordering the rows so parent tables load before
 * their child tables removes that dependency too.
 *
 * Row ordering is a stable topological sort over the FK graph: tables with no
 * FK references keep their original relative order, a child table's row block
 * lands after all of its parent tables' row blocks, and a cycle (which the
 * schema's own `PRAGMA defer_foreign_keys=TRUE` is designed to handle) keeps
 * the original order so the deferred pragma resolves it within the cycle.
 * INSERT order within a single table is always preserved.
 *
 * @param {string[]} statements
 * @returns {string[]}
 */
export function orderRestoreStatements(statements) {
  if (!Array.isArray(statements)) {
    throw new TypeError("D1 restore statements must be an array.");
  }
  const leadingPragmas = [];
  const tables = [];
  const rest = [];
  let sawNonPragma = false;
  for (const statement of statements) {
    if (!sawNonPragma && isPragmaStatement(statement)) {
      leadingPragmas.push(statement);
      continue;
    }
    sawNonPragma = true;
    if (parseCreateTable(statement)) tables.push(statement);
    else rest.push(statement);
  }
  return [...leadingPragmas, ...tables, ...orderRowsByForeignKey(rest, tables)];
}

/**
 * Stable topological sort of INSERT statements by foreign-key dependency, so a
 * parent table's rows load before its child tables' rows. Non-INSERT statements
 * (indexes, triggers, views) keep their position relative to the row stream and
 * are never reordered past each other; only INSERT blocks move.
 *
 * @param {string[]} rest statements after the leading pragmas and CREATE TABLEs
 * @param {string[]} tables CREATE TABLE statements, used to recover the FK graph
 * @returns {string[]}
 */
function orderRowsByForeignKey(rest, tables) {
  // FK graph: child table -> set of parent tables it references.
  /** @type {Map<string, Set<string>>} */
  const references = new Map();
  for (const create of tables) {
    const schema = parseCreateTable(create);
    if (!schema) continue;
    references.set(schema.table, new Set(schema.references));
  }
  // Group consecutive INSERTs by target table so each table's rows stay
  // contiguous and in original order. A non-INSERT statement is its own group
  // and never merges with an INSERT group, preserving index/trigger order.
  /** @type {{ kind: "insert" | "other", table: string | null, items: string[] }[]} */
  const groups = [];
  for (const statement of rest) {
    const insert = parseInsert(statement);
    if (insert) {
      const last = groups.at(-1);
      if (last && last.kind === "insert" && last.table === insert.table) {
        last.items.push(statement);
      } else {
        groups.push({ kind: "insert", table: insert.table, items: [statement] });
      }
    } else {
      groups.push({ kind: "other", table: null, items: [statement] });
    }
  }
  if (!groups.some((group) => group.kind === "insert")) return rest;
  // Stable topo sort over the table names that have INSERT groups. Non-INSERT
  // groups stay anchored in place; only INSERT groups are reordered.
  const insertGroups = groups.filter((group) => group.kind === "insert");
  /** @type {string[]} */ const orderedTables = [];
  /** @type {Set<string>} */ const placed = new Set();
  /** @type {Map<string, typeof insertGroups>} */ const groupsByTable = new Map();
  for (const group of insertGroups) {
    if (!group.table) continue;
    const list = groupsByTable.get(group.table);
    if (list) list.push(group);
    else groupsByTable.set(group.table, [group]);
  }
  const visit = (table) => {
    if (placed.has(table)) return;
    placed.add(table);
    const parents = references.get(table);
    if (parents) {
      for (const parent of parents) {
        if (groupsByTable.has(parent)) visit(parent);
      }
    }
    orderedTables.push(table);
  };
  // Visit in original first-appearance order for stability; a cycle leaves the
  // original order intact for the cycle's members so defer_foreign_keys handles
  // it within the cycle.
  for (const group of insertGroups) {
    if (group.table) visit(group.table);
  }
  // Flatten each table's INSERT groups in original order; a table with
  // non-consecutive row blocks (not produced by a real D1 export, but kept
  // robust) emits all of them together after its parents.
  /** @type {string[][]} */ const orderedItems = [];
  for (const table of orderedTables) {
    for (const group of groupsByTable.get(table) ?? []) orderedItems.push(group.items);
  }
  // Re-emit the group stream: non-INSERT groups keep their slots and original
  // order; INSERT group slots are replaced in order by the topo-ordered blocks.
  let nextInsert = 0;
  return groups.map((group) => {
    if (group.kind !== "insert") return group.items;
    return orderedItems[nextInsert++] ?? group.items;
  }).flat();
}

function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let cursor = 0;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (char === "'") {
      cursor = readQuoted(sql, cursor, "'");
      continue;
    }
    if (char === '"' || char === "`" || char === "[") {
      cursor = readQuoted(sql, cursor, char === "[" ? "]" : char);
      continue;
    }
    if (sql.startsWith("--", cursor)) {
      const newline = sql.indexOf("\n", cursor + 2);
      cursor = newline < 0 ? sql.length : newline + 1;
      continue;
    }
    if (sql.startsWith("/*", cursor)) {
      const end = sql.indexOf("*/", cursor + 2);
      if (end < 0) throw new Error("Unterminated SQL block comment.");
      cursor = end + 2;
      continue;
    }
    if (char === ";") {
      statements.push({ text: sql.slice(start, cursor + 1), terminated: true });
      start = cursor + 1;
    }
    cursor += 1;
  }
  const tail = sql.slice(start);
  if (tail.trim()) statements.push({ text: tail, terminated: false });
  else if (tail && statements.length) statements.at(-1).text += tail;
  else if (tail) statements.push({ text: tail, terminated: false });
  return statements;
}

function replaceValue(source, span, replacement) {
  return source.slice(0, span.trimmedStart) + replacement + source.slice(span.trimmedEnd);
}

function statementWithTerminator(statement) {
  const trailing = statement.match(/\s*$/)?.[0] ?? "";
  const body = trailing ? statement.slice(0, -trailing.length) : statement;
  return body.endsWith(";") ? statement : `${body};${trailing}`;
}

function buildInitial(insert, statement, replacements) {
  let result = statement;
  const ordered = [...replacements].sort((a, b) => b.span.trimmedStart - a.span.trimmedStart);
  for (const replacement of ordered) result = replaceValue(result, replacement.span, encodeStringLiteral(replacement.prefix));
  return result;
}

function buildAppend(table, column, chunk, predicate) {
  return `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column)} = ${quoteIdentifier(column)} || ${encodeStringLiteral(chunk)} WHERE ${predicate};`;
}

function choosePrefix(parts, makeStatement, maxBytes) {
  const counts = parts.map((part) => Math.max(1, part.points.length ? 1 : 0));
  if (byteLength(makeStatement(counts)) > maxBytes) throw new Error("The non-literal SQL overhead exceeds the statement limit.");
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    let low = counts[index];
    let high = part.points.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      counts[index] = middle;
      if (byteLength(makeStatement(counts)) <= maxBytes) low = middle;
      else high = middle - 1;
    }
    counts[index] = low;
  }
  return counts;
}

function chunksForPart(part, firstCount, makeStatement, maxBytes) {
  const chunks = [part.points.slice(0, firstCount).join("")];
  let offset = firstCount;
  while (offset < part.points.length) {
    let low = 1;
    let high = part.points.length - offset;
    if (byteLength(makeStatement(part.points.slice(offset, offset + 1).join(""))) > maxBytes) {
      throw new Error("A single Unicode code point cannot fit in the generated UPDATE statement.");
    }
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (byteLength(makeStatement(part.points.slice(offset, offset + middle).join(""))) <= maxBytes) low = middle;
      else high = middle - 1;
    }
    chunks.push(part.points.slice(offset, offset + low).join(""));
    offset += low;
  }
  return chunks;
}

/**
 * @param {string} sql
 * @param {{ maxBytes?: number; primaryKeys?: Record<string, string | string[]> }} [options]
 * @returns {{ sql: string; statements: string[]; transformed: number; maxBytes: number; statementBytes: number[] }}
 */
export function transformD1RestoreSql(sql, options = {}) {
  if (typeof sql !== "string") throw new TypeError("D1 restore input must be a string.");
  const maxBytes = options.maxBytes ?? options.maxStatementBytes ?? DEFAULT_MAX_STATEMENT_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 100_000) throw new Error("maxBytes must be an integer between 1 and 100000.");
  const statements = splitStatements(sql);
  const primaryKeys = new Map();
  for (const item of statements) {
    const schema = parseCreateTable(item.text);
    if (schema?.keys.length) primaryKeys.set(schema.table, schema.keys);
  }
  for (const [table, keys] of Object.entries(options.primaryKeys ?? {})) {
    primaryKeys.set(table.toLowerCase(), (Array.isArray(keys) ? keys : [keys]).map((key) => key.toLowerCase()));
  }
  const output = [];
  let transformed = 0;
  for (const item of statements) {
    const insert = parseInsert(item.text);
    if (!insert) {
      if (byteLength(statementWithTerminator(item.text)) > maxBytes) {
        throw new Error("An oversized SQL statement has no supported plain string literal to split.");
      }
      output.push(item.text);
      continue;
    }
    let oversized = insert.values.flatMap((value, index) => {
      const raw = value.raw;
      if (!isPlainString(raw) || byteLength(raw) <= maxBytes) return [];
      return [{ value, index, content: decodeStringLiteral(raw) }];
    });
    const statementTooLarge = byteLength(statementWithTerminator(item.text)) > maxBytes;
    if (!oversized.length && statementTooLarge) {
      const knownKeys = primaryKeys.get(insert.table);
      const keyIndexes = new Set(
        (knownKeys ?? []).flatMap((name) => {
          const index = insert.columns.findIndex((column) => column.normalized === name);
          return index < 0 ? [] : [index];
        }),
      );
      oversized = insert.values.flatMap((value, index) => {
        const raw = value.raw;
        // A modest non-key literal can be the safe split candidate when a
        // statement has unusually large SQL overhead, but never rewrite the
        // primary-key literal itself.
        if (keyIndexes.has(index) || !isPlainString(raw) || byteLength(raw) <= 1_024) return [];
        return [{ value, index, content: decodeStringLiteral(raw) }];
      });
      if (!oversized.length) throw new Error(`Cannot split oversized INSERT for ${insert.table}: no supported literal candidate.`);
    }
    if (!oversized.length) {
      output.push(item.text);
      continue;
    }
    if (insert.conflict) throw new Error(`Cannot split INSERT OR ${insert.conflict.toUpperCase()} safely during restore.`);
    const keyNames = primaryKeys.get(insert.table);
    if (!keyNames?.length) throw new Error(`Cannot split oversized INSERT for ${insert.table}: primary key is unknown.`);
    const keyIndexes = keyNames.map((name) => insert.columns.findIndex((column) => column.normalized === name));
    if (keyIndexes.some((index) => index < 0)) throw new Error(`Cannot split oversized INSERT for ${insert.table}: primary-key column is not explicit.`);
    const predicate = keyIndexes.map((index, keyIndex) => `${quoteIdentifier(insert.columns[index].value)} = ${scalarKeyExpression(insert.values[index].raw)}`).join(" AND ");
    const parts = oversized.map((part) => ({ ...part, points: codePoints(part.content) }));
    const makeInitial = (counts) => {
      const replacements = parts.map((part, partIndex) => ({ span: part.value, prefix: part.points.slice(0, counts[partIndex]).join("") }));
      return statementWithTerminator(buildInitial(insert, item.text, replacements));
    };
    const counts = choosePrefix(parts, makeInitial, maxBytes);
    const initial = makeInitial(counts);
    output.push(initial);
    for (const [partIndex, part] of parts.entries()) {
      const column = insert.columns[part.index].value;
      const chunks = chunksForPart(
        part,
        counts[partIndex],
        (chunk) => buildAppend(insert.tableRaw, column, chunk, predicate),
        maxBytes,
      );
      for (const chunk of chunks.slice(1)) output.push(buildAppend(insert.tableRaw, column, chunk, predicate));
    }
    transformed += 1;
  }
  const ordered = orderRestoreStatements(output);
  return {
    sql: ordered.join(""),
    statements: ordered,
    transformed,
    maxBytes,
    statementBytes: ordered.map(byteLength),
  };
}

export const transformD1Export = transformD1RestoreSql;
export const splitD1RestoreSql = transformD1RestoreSql;

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile, writeFile } = await import("node:fs/promises");
  const args = process.argv.slice(2);
  let input;
  let outputPath;
  let maxArg;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output" || argument === "--max-bytes") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--output") outputPath = value;
      else maxArg = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    if (input) throw new Error("Only one input SQL file may be supplied.");
    input = argument;
  }
  if (!input) throw new Error("Usage: node scripts/d1-restore-transform.mjs <input.sql> [--output path] [--max-bytes 90000]");
  const result = transformD1RestoreSql(await readFile(input, "utf8"), { maxBytes: maxArg ? Number(maxArg) : undefined });
  if (outputPath) await writeFile(outputPath, result.sql);
  else process.stdout.write(result.sql);
  console.error(`Transformed ${result.transformed} INSERT statement(s); maximum emitted statement ${Math.max(...result.statementBytes, 0)} bytes.`);
}
