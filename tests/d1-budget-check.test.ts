import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  applyMigrationsToDatabase,
  estimateQueryRows,
  parseEstimates,
  runBudgetCheck,
  scanCanaryBudgets,
} from "../scripts/ci-d1-budget-check.lib.mjs";

const REPO_ROOT = process.cwd();

function estimates(overrides: Record<string, unknown> = {}) {
  return parseEstimates({
    tables: { orders: 1_000, customers: 500 },
    ...overrides,
  });
}

function scratchDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT, status TEXT, created_at TEXT);
     CREATE UNIQUE INDEX idx_orders_customer ON orders (customer_id);
     CREATE INDEX idx_orders_status ON orders (status);
     CREATE TABLE customers (id TEXT PRIMARY KEY, email TEXT UNIQUE);`,
  );
  return db;
}

describe("ci-d1-budget-check", () => {
  it("applies every real migration to a scratch schema", () => {
    const db = new DatabaseSync(":memory:");
    const applied = applyMigrationsToDatabase(db, join(REPO_ROOT, "migrations"));
    expect(applied).toBeGreaterThan(70);
    const tables = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get() as { n: number };
    expect(tables.n).toBeGreaterThan(70);
  });

  it("charges a table SCAN the full table estimate", () => {
    const db = scratchDb();
    const result = estimateQueryRows(
      db,
      { name: "scan", sql: "SELECT id FROM orders", callsPerDay: 1 },
      estimates(),
    );
    expect(result.readsPerCall).toBe(1_000);
  });

  it("charges a unique-index point lookup one row", () => {
    const db = scratchDb();
    const result = estimateQueryRows(
      db,
      { name: "pk", sql: "SELECT id FROM orders WHERE id = ?", callsPerDay: 1 },
      estimates(),
    );
    expect(result.readsPerCall).toBe(1);
  });

  it("multiplies later join loops by earlier rows and resolves aliases", () => {
    const db = scratchDb();
    const result = estimateQueryRows(
      db,
      {
        name: "join",
        sql: "SELECT o.id FROM orders o INNER JOIN customers c ON c.id = o.customer_id WHERE o.status = ?",
        callsPerDay: 1,
        rowsPerIndexedSearch: 10,
      },
      estimates(),
    );
    // orders status range scan (10) then one point lookup per row (10 x 1).
    expect(result.readsPerCall).toBe(20);
    expect(result.accessNodes.map((n) => n.table)).toEqual(["orders", "customers"]);
  });

  it("treats MULTI-INDEX OR branches as alternatives, not nested loops", () => {
    const db = scratchDb();
    const result = estimateQueryRows(
      db,
      {
        name: "or",
        sql: "SELECT id FROM orders WHERE status = ? OR customer_id = ?",
        callsPerDay: 1,
        rowsPerIndexedSearch: 10,
      },
      estimates(),
    );
    // Two index arms: 10 (range) + 1 (unique point lookup), never 10 x 1.
    expect(result.readsPerCall).toBe(11);
  });

  it("fails closed when a plan touches a table with no estimate", () => {
    const db = scratchDb();
    expect(() =>
      estimateQueryRows(
        db,
        { name: "ghost", sql: "SELECT id FROM orders o JOIN mystery m ON m.id = o.id", callsPerDay: 1 },
        estimates(),
      ),
    ).toThrow(/mystery/);
  });

  it("counts UPDATE/DELETE writes as rows touched and INSERT as writesPerCall", () => {
    const db = scratchDb();
    const update = estimateQueryRows(
      db,
      { name: "u", sql: "UPDATE orders SET status = ? WHERE status = ?", callsPerDay: 1, rowsPerIndexedSearch: 40 },
      estimates(),
    );
    expect(update.writesPerCall).toBe(40);
    const insert = estimateQueryRows(
      db,
      { name: "i", sql: "INSERT INTO orders (id) VALUES (?)", callsPerDay: 1 },
      estimates(),
    );
    expect(insert.writesPerCall).toBe(1);
  });

  it("requires every canary to declare its D1 budget", () => {
    const root = mkdtempSync(join(tmpdir(), "d1-budget-canary-"));
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(root, "scripts", "ok-canary.mjs"),
      "// d1-budget: reads=10 writes=2 runs_per_day=4\n",
    );
    writeFileSync(join(root, "scripts", "silent-canary.mjs"), "// no declaration\n");
    writeFileSync(join(root, "scripts", "helper-canary.lib.mjs"), "// lib exempt\n");

    const result = scanCanaryBudgets(root);
    expect(result.declarations).toEqual([
      { file: join("scripts", "ok-canary.mjs"), reads: 10, writes: 2, runsPerDay: 4 },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("silent-canary.mjs");
    expect(result.errors[0]).toContain("d1-budget:");
  });

  it("fails when the daily estimate crosses the trip threshold", () => {
    const root = mkdtempSync(join(tmpdir(), "d1-budget-trip-"));
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "migrations"), { recursive: true });
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, "migrations", "0001_init.sql"), "CREATE TABLE big (id TEXT);");
    writeFileSync(
      join(root, "scripts", "d1-budget-estimates.json"),
      JSON.stringify({ tables: { big: 400_000 } }),
    );
    writeFileSync(
      join(root, "scripts", "d1-budget-queries.json"),
      JSON.stringify({ queries: [{ name: "huge", sql: "SELECT id FROM big", callsPerDay: 2 }] }),
    );
    writeFileSync(join(root, "scripts", "probe-canary.mjs"), "// d1-budget: reads=1 writes=0\n");

    const result = runBudgetCheck(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/exceeds .* trip threshold/);
  });

  it("passes on the real repo config with every canary declaring", () => {
    const result = runBudgetCheck(REPO_ROOT);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.totals.readsPerDay).toBeGreaterThan(0);
    expect(result.totals.readsPerDay).toBeLessThanOrEqual(result.totals.readTrip);
    expect(result.totals.writesPerDay).toBeLessThanOrEqual(result.totals.writeTrip);
  });
});
