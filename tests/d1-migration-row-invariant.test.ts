import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyMigrationsToCopy,
  assertMigrationRowInvariant,
  evaluateMigrationRowInvariant,
  formatRowCountDiff,
  parseExpectsRowLoss,
  readTableRowCounts,
} from "../scripts/d1-migration-row-invariant.mjs";

/**
 * Gate for issue #2779. This is the invariant that catches what lints cannot
 * foresee: on 2026-09-09 migration 0087 rebuilt `user`, `PRAGMA foreign_keys
 * = OFF` was a no-op inside D1's migration transaction, and 55 ON DELETE
 * CASCADE children emptied with it (fleet-ops#4999).
 *
 * These tests are the runnable form of the issue's "do" item 4:
 *   - a fixture migration that drops-and-recreates a parent with cascading
 *     children turns the gate red;
 *   - the same migration with the `expects-row-loss` annotation passes;
 *   - a purely additive migration passes;
 *   - the real, currently-shipped 0087 file fails the gate.
 */

const roots: string[] = [];

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "0509-row-invariant-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A seeded parent/child pair that mirrors the `user` + cascade-children shape
 * from the incident: dropping the parent empties every child through
 * ON DELETE CASCADE when foreign key enforcement is on.
 */
function seedCascadeFixture(root: string) {
  const databasePath = join(root, "seed.sqlite");
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
  });
  database.exec(`
    CREATE TABLE parent (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL
    );
    CREATE TABLE child (
      id TEXT PRIMARY KEY NOT NULL,
      parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE
    );
    CREATE TABLE other_child (
      id TEXT PRIMARY KEY NOT NULL,
      parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE
    );
    INSERT INTO parent (id, label) VALUES ('p1', 'one'), ('p2', 'two');
    INSERT INTO child (id, parent_id) VALUES ('c1', 'p1'), ('c2', 'p2');
    INSERT INTO other_child (id, parent_id) VALUES ('o1', 'p1');
  `);
  database.close();
  return databasePath;
}

function writeMigration(root: string, name: string, sql: string) {
  const path = join(root, name);
  writeFileSync(path, sql, "utf8");
  return { name, path };
}

/** The destructive shape: DROP the parent, recreate it, copy the parent rows. */
const DESTRUCTIVE_REBUILD = `
CREATE TABLE parent_new (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL
);
INSERT INTO parent_new (id, label) SELECT id, label FROM parent;
DROP TABLE parent;
ALTER TABLE parent_new RENAME TO parent;
`;

describe("migration row-count invariant (issue #2779)", () => {
  it("(1) a parent rebuild with cascading children turns the gate red", () => {
    const root = tempRoot();
    const sourcePath = seedCascadeFixture(root);
    const migration = writeMigration(
      root,
      "9000_destructive_rebuild.sql",
      DESTRUCTIVE_REBUILD,
    );

    const result = applyMigrationsToCopy({
      sourcePath,
      migrations: [migration],
    });
    const verdict = evaluateMigrationRowInvariant({
      before: result.before,
      after: result.after,
      expectedRowLossByMigration: result.expectedRowLossByMigration,
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.declared).toEqual([]);
    const losses = Object.fromEntries(
      verdict.losses.map((loss) => [loss.table, [loss.before, loss.after]]),
    );
    // The parent keeps its rows; the cascading children empty out. This is
    // the exact 0087 signature (user_plan 0, watchlist 0, session 0).
    expect(losses).toEqual({
      child: [2, 0],
      other_child: [1, 0],
    });
    expect(() =>
      assertMigrationRowInvariant({
        before: result.before,
        after: result.after,
        expectedRowLossByMigration: result.expectedRowLossByMigration,
      }),
    ).toThrow(/migration_row_loss_unexpected/);
  });

  it("(2) the same destructive migration passes when it declares expects-row-loss", () => {
    const root = tempRoot();
    const sourcePath = seedCascadeFixture(root);
    const migration = writeMigration(
      root,
      "9001_declared_rebuild.sql",
      `-- expects-row-loss: child,other_child\n${DESTRUCTIVE_REBUILD}`,
    );

    const result = applyMigrationsToCopy({
      sourcePath,
      migrations: [migration],
    });
    const verdict = evaluateMigrationRowInvariant({
      before: result.before,
      after: result.after,
      expectedRowLossByMigration: result.expectedRowLossByMigration,
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.losses).toEqual([]);
    expect(verdict.declared).toEqual(["child", "other_child"]);
  });

  it("(3) a purely additive migration passes", () => {
    const root = tempRoot();
    const sourcePath = seedCascadeFixture(root);
    const migration = writeMigration(
      root,
      "9002_additive.sql",
      `
CREATE TABLE brand_new (id TEXT PRIMARY KEY NOT NULL);
INSERT INTO brand_new (id) VALUES ('b1');
ALTER TABLE child ADD COLUMN note TEXT;
UPDATE child SET note = 'hello';
`,
    );

    const result = applyMigrationsToCopy({
      sourcePath,
      migrations: [migration],
    });
    const verdict = evaluateMigrationRowInvariant({
      before: result.before,
      after: result.after,
      expectedRowLossByMigration: result.expectedRowLossByMigration,
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.losses).toEqual([]);
    // The new table appears after the migration but cannot lose rows it
    // never had, so it is reported without being treated as a loss.
    const after = new Map(result.after.map((r) => [r.table, r.count]));
    expect(after.get("brand_new")).toBe(1);
    expect(after.get("child")).toBe(2);
  });

  it("(4) an unused annotation is not a blanket licence — only the named table is excused", () => {
    const root = tempRoot();
    const sourcePath = seedCascadeFixture(root);
    const migration = writeMigration(
      root,
      "9003_partial_declaration.sql",
      `-- expects-row-loss: other_child\n${DESTRUCTIVE_REBUILD}`,
    );

    const result = applyMigrationsToCopy({
      sourcePath,
      migrations: [migration],
    });
    const verdict = evaluateMigrationRowInvariant({
      before: result.before,
      after: result.after,
      expectedRowLossByMigration: result.expectedRowLossByMigration,
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.losses.map((loss) => loss.table)).toEqual(["child"]);
  });

  it("(5) the shipped 0087 file passes the invariant after the #2774 rewrite, while the pre-rewrite loss shape still turns the gate red", () => {
    // 0087 has been rewritten for issue #2774: it now stages every table in
    // the transitive CASCADE closure of `user` (which reads `account` and 56
    // siblings), rebuilds `user`, and restores the staged rows. A hand-rolled
    // mini-schema cannot run it — the second worker run here saw
    // "no such table: account" when a mid-air collision with #2774 landed
    // the rewrite behind this test. So the incident shape is now exercised
    // the honest way: build the source database by applying the REAL chain
    // files before 0087, seed rows, then run the real 0087 in one
    // FK-enforced transaction (mirroring D1) through the invariant.
    const chainNames = readdirSync(resolve("migrations"))
      .filter(
        (name) =>
          /^\d{4}_.+\.sql$/u.test(name) &&
          name !== "0087_signup_source_open_allowlist.sql",
      )
      .sort();

    function buildIncidentSource(root: string) {
      const databasePath = join(root, "incident.sqlite");
      const database = new DatabaseSync(databasePath, {
        enableForeignKeyConstraints: true,
      });
      for (const name of chainNames) {
        database.exec("BEGIN");
        database.exec(readFileSync(resolve("migrations", name), "utf8"));
        database.exec("COMMIT");
      }
      // The rows that were in production when 0087 emptied the children:
      // users plus cascade-children rows.
      database.exec(`
        INSERT INTO user (id, name, email, createdAt, updatedAt)
          VALUES ('u1', 'A', 'a@example.com', '2026-01-01', '2026-01-01'),
                 ('u2', 'B', 'b@example.com', '2026-01-01', '2026-01-01');
        INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
          VALUES ('a1', 'acc-1', 'password', 'u1', '2026-01-01', '2026-01-01');
        INSERT INTO user_plan (user_id, plan) VALUES ('u1', 'free'), ('u2', 'free');
        INSERT INTO watchlist (
          id, user_id, name, target_type, target_id, target_fingerprint,
          target_label, created_at, updated_at
        ) VALUES (
          'w1', 'u1', 'One', 'advertiser', 'a-1', 'fp-1', 'One',
          '2026-01-01', '2026-01-01'
        );
        INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
          VALUES ('s1', '2027-01-01', 'tok-1', '2026-01-01', '2026-01-01', 'u1');
      `);
      database.close();
      return databasePath;
    }

    const root = tempRoot();
    const databasePath = buildIncidentSource(root);

    const name = "0087_signup_source_open_allowlist.sql";
    const source = readFileSync(resolve("migrations", name), "utf8");
    // The rewritten file carries no annotation; it is loss-free by
    // construction. If a future PR re-introduces a loss without the
    // annotation, the applied check below is what goes red.
    expect([...parseExpectsRowLoss(source)]).toEqual([]);

    const result = applyMigrationsToCopy({
      sourcePath: databasePath,
      migrations: [{ name, path: resolve("migrations", name) }],
    });
    const verdict = evaluateMigrationRowInvariant({
      before: result.before,
      after: result.after,
      expectedRowLossByMigration: result.expectedRowLossByMigration,
    });
    expect(verdict.ok, formatRowCountDiff({ before: result.before, after: result.after })).toBe(true);
    expect(verdict.losses).toEqual([]);
    const after = new Map(result.after.map((r) => [r.table, r.count]));
    expect(after.get("user_plan")).toBe(2);
    expect(after.get("watchlist")).toBe(1);
    expect(after.get("session")).toBe(1);
    expect(after.get("account")).toBe(1);

    // And the gate is still sharp on this file's destructive class: the
    // pre-#2774 bug was that the drop's cascades emptied the children. Drop
    // the restore section from the real file and the remaining staged drop
    // must wipe `account` and friends, going red with a real count loss.
    const sabotaged = source.replace(
      /INSERT INTO account SELECT \* FROM mig0087_account;\nDROP TABLE mig0087_account;/u,
      "",
    );
    expect(sabotaged).not.toEqual(source);
    const sabotageRoot = mkdtempSync(join(tmpdir(), "0509-0087-sabotage-"));
    roots.push(sabotageRoot);
    const sabotagedPath = writeMigration(
      sabotageRoot,
      "0087_signup_source_open_allowlist_sabotaged.sql",
      sabotaged,
    );
    const sabotagedResult = applyMigrationsToCopy({
      sourcePath: databasePath,
      migrations: [sabotagedPath],
    });
    const sabotagedVerdict = evaluateMigrationRowInvariant({
      before: sabotagedResult.before,
      after: sabotagedResult.after,
      expectedRowLossByMigration: sabotagedResult.expectedRowLossByMigration,
    });
    expect(sabotagedVerdict.ok).toBe(false);
    const sabotageLosses = Object.fromEntries(
      sabotagedVerdict.losses.map((loss) => [loss.table, [loss.before, loss.after]]),
    );
    expect(sabotageLosses).toMatchObject({
      account: [1, 0],
    });
    // Only the sabotaged restore is skipped: user_plan/watchlist/session are
    // staged earlier in the file and survive even in the sabotaged run —
    // which is exactly what the staging+restore repair bought.
    expect(sabotagedVerdict.losses.map((loss) => loss.table)).toEqual([
      "account",
    ]);
  });

  it("(6) dropping a populated table outright is a loss of all its rows", () => {
    const root = tempRoot();
    const sourcePath = seedCascadeFixture(root);
    const migration = writeMigration(
      root,
      "9004_drop_child.sql",
      "DROP TABLE other_child;\n",
    );

    const result = applyMigrationsToCopy({
      sourcePath,
      migrations: [migration],
    });
    const verdict = evaluateMigrationRowInvariant({
      before: result.before,
      after: result.after,
      expectedRowLossByMigration: result.expectedRowLossByMigration,
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.losses).toEqual([
      { table: "other_child", before: 1, after: 0, tableRemoved: true },
    ]);
  });

  it("(7) the annotation parser is strict about shape", () => {
    expect([...parseExpectsRowLoss("-- expects-row-loss: a,b\n")]).toEqual([
      "a",
      "b",
    ]);
    expect([
      ...parseExpectsRowLoss("  --   expects-row-loss:  alpha , beta  \n"),
    ]).toEqual(["alpha", "beta"]);
    expect([
      ...parseExpectsRowLoss(
        "-- expects-row-loss: a\n-- expects-row-loss: b\n",
      ),
    ]).toEqual(["a", "b"]);
    expect([...parseExpectsRowLoss("-- unrelated comment\n")]).toEqual([]);
    // A migration name or a quoted identifier is not a table name.
    expect(() =>
      parseExpectsRowLoss("-- expects-row-loss: 0087_thing.sql\n"),
    ).toThrow(/migration_row_invariant_annotation_table_invalid/);
    // A line that only LOOKS like a declaration because it sits inside a
    // block comment is not one.
    expect([
      ...parseExpectsRowLoss("/*\n-- expects-row-loss: user_plan\n*/\n"),
    ]).toEqual([]);
    // A real line comment after a closed block comment still counts.
    expect([
      ...parseExpectsRowLoss(
        "/* prose */\n-- expects-row-loss: user_plan\n",
      ),
    ]).toEqual(["user_plan"]);
  });

  it("(10) a declaration from a file that did not cause the loss does not excuse it", () => {
    const root = tempRoot();
    const sourcePath = seedCascadeFixture(root);
    // 9005 does NOT touch child; 9006 is the culprit and declares nothing.
    const innocent = writeMigration(
      root,
      "9005_innocent.sql",
      "-- expects-row-loss: child\nCREATE TABLE unrelated (id TEXT PRIMARY KEY NOT NULL);\n",
    );
    const culprit = writeMigration(
      root,
      "9006_culprit.sql",
      DESTRUCTIVE_REBUILD,
    );

    const result = applyMigrationsToCopy({
      sourcePath,
      migrations: [innocent, culprit],
    });
    const verdict = evaluateMigrationRowInvariant({
      before: result.before,
      after: result.after,
      expectedRowLossByMigration: result.expectedRowLossByMigration,
      perMigrationCounts: result.perMigrationCounts,
    });

    // `child` is declared by 9005 but was emptied by 9006, so it is NOT
    // excused: the union of all declarations would have passed this.
    expect(verdict.ok).toBe(false);
    expect(verdict.losses.map((loss) => loss.table)).toEqual([
      "child",
      "other_child",
    ]);
  });

  it("(11) the culprit's own declaration is honoured", () => {
    const root = tempRoot();
    const sourcePath = seedCascadeFixture(root);
    const culprit = writeMigration(
      root,
      "9007_culprit_declared.sql",
      `-- expects-row-loss: child,other_child\n${DESTRUCTIVE_REBUILD}`,
    );

    const result = applyMigrationsToCopy({
      sourcePath,
      migrations: [culprit],
    });
    const verdict = evaluateMigrationRowInvariant({
      before: result.before,
      after: result.after,
      expectedRowLossByMigration: result.expectedRowLossByMigration,
      perMigrationCounts: result.perMigrationCounts,
    });

    expect(verdict.ok).toBe(true);
  });

  it("(8) the summary diff names every changed table", () => {
    const diff = formatRowCountDiff({
      before: [
        { table: "user_plan", count: 6 },
        { table: "watchlist", count: 3 },
      ],
      after: [
        { table: "user_plan", count: 0 },
        { table: "watchlist", count: 3 },
      ],
    });
    expect(diff).toContain("| user_plan | 6 | 0 | -6 |");
    expect(diff).toContain("| watchlist | 3 | 3 | 0 |");
  });

  it("(9) readTableRowCounts agrees with the pre-migration snapshot", () => {
    const root = tempRoot();
    const sourcePath = seedCascadeFixture(root);
    expect(readTableRowCounts(sourcePath)).toEqual([
      { table: "child", count: 2 },
      { table: "other_child", count: 1 },
      { table: "parent", count: 2 },
    ]);
  });
});
