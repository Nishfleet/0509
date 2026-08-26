import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteD1 } from "./sqlite-d1";

const harnesses: Array<ReturnType<typeof createSqliteD1>> = [];

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.close();
});

function openHarness() {
  const harness = createSqliteD1();
  harnesses.push(harness);
  harness.sqlite.exec(`
    CREATE TABLE t (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      email TEXT NOT NULL
    );
  `);
  return harness;
}

describe("sqlite-d1 numbered D1 placeholders", () => {
  it("binds ?1/?2/?3 through run, first, and all", async () => {
    const { db } = openHarness();

    await db
      .prepare("INSERT INTO t (id, owner, email) VALUES (?1, ?2, ?3)")
      .bind("row-1", "owner-1", "a@x.com")
      .run();

    const first = await db
      .prepare("SELECT email FROM t WHERE id = ?1 AND owner = ?2")
      .bind("row-1", "owner-1")
      .first<{ email: string }>();
    expect(first).toEqual({ email: "a@x.com" });

    const { results } = await db
      .prepare("SELECT id FROM t WHERE owner = ?1")
      .bind("owner-1")
      .all<{ id: string }>();
    expect(results).toEqual([{ id: "row-1" }]);
  });

  it("reuses a numbered placeholder the way workspace invite SQL does", async () => {
    const { db } = openHarness();

    await db
      .prepare(
        `INSERT INTO t (id, owner, email)
         SELECT ?1, ?2, ?3
          WHERE ?2 = ?2
            AND ?6 > 0`,
      )
      .bind("row-2", "owner-2", "b@x.com", "unused-4", "unused-5", 1)
      .run();

    const row = await db
      .prepare("SELECT owner, email FROM t WHERE id = ?1")
      .bind("row-2")
      .first<{ owner: string; email: string }>();
    expect(row).toEqual({ owner: "owner-2", email: "b@x.com" });
  });

  it("still binds anonymous ? placeholders", async () => {
    const { db } = openHarness();

    await db
      .prepare("INSERT INTO t (id, owner, email) VALUES (?, ?, ?)")
      .bind("row-3", "owner-3", "c@x.com")
      .run();

    const row = await db
      .prepare("SELECT email FROM t WHERE id = ?")
      .bind("row-3")
      .first<{ email: string }>();
    expect(row).toEqual({ email: "c@x.com" });
  });
});

const SHARED_HELPER = "tests/helpers/sqlite-d1.ts";
const PRIVATE_HELPER = /\bfunction createSqliteD1\s*\(/;
const ANONYMOUS_NUMBERED_BIND = /toSqliteBindings\s*=\s*\(\s*bindings/;

function testSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return testSourceFiles(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

describe("sqlite-d1 helper is the only D1 sqlite harness", () => {
  it("rejects private createSqliteD1 copies that spread numbered placeholders as anonymous binds", () => {
    const offenders = testSourceFiles("tests").flatMap((file) => {
      if (file === SHARED_HELPER) return [];
      const source = readFileSync(file, "utf8");
      const hits: string[] = [];
      if (PRIVATE_HELPER.test(source)) hits.push(`${file}: private createSqliteD1`);
      if (ANONYMOUS_NUMBERED_BIND.test(source)) {
        hits.push(`${file}: identity toSqliteBindings (numbered ?N will SQLITE_RANGE)`);
      }
      return hits;
    });

    expect(offenders).toEqual([]);
  });
});
