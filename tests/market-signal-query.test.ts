import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

// db/queries/market-signal.sql is what the daily workflow runs with
// `wrangler d1 execute --file`. Prove it against the real migrated schema.
describe("db/queries/market-signal.sql", () => {
  it("runs against the migrated schema and returns one row with the contract's columns", () => {
    const db = new DatabaseSync(":memory:");
    for (const file of readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) {
      db.exec(readFileSync(`migrations/${file}`, "utf8"));
    }
    const rows = db.prepare(readFileSync("db/queries/market-signal.sql", "utf8")).all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    for (const column of ["users_total", "active_watchlists", "support_open", "synthetic_users_total"]) {
      expect(rows[0], column).toHaveProperty(column);
    }
  });
});
