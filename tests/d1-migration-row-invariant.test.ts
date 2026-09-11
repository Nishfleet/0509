import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("(5) the currently-shipped 0087 file fails the gate", () => {
    const root = tempRoot();
    const databasePath = join(root, "incident.sqlite");
    const database = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
    });
    // Mirrors the production shape 0087 operates on: `user` plus the cascade
    // children that went to 0 rows on 2026-09-09.
    database.exec(`
      CREATE TABLE user (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        emailVerified INTEGER NOT NULL DEFAULT 0,
        image TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        onboardedAt TEXT,
        signup_source TEXT
      );
      CREATE TABLE user_plan (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
      );
      CREATE TABLE watchlist (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
      );
      CREATE TABLE session (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
      );
      CREATE TABLE signup_source_pending (
        email TEXT PRIMARY KEY NOT NULL,
        signup_source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      INSERT INTO user (id, name, email, createdAt, updatedAt)
        VALUES ('u1', 'A', 'a@example.com', '2026-01-01', '2026-01-01'),
               ('u2', 'B', 'b@example.com', '2026-01-01', '2026-01-01');
      INSERT INTO user_plan (id, user_id) VALUES ('p1', 'u1'), ('p2', 'u2');
      INSERT INTO watchlist (id, user_id) VALUES ('w1', 'u1');
      INSERT INTO session (id, user_id) VALUES ('s1', 'u1');
    `);
    database.close();

    const name = "0087_signup_source_open_allowlist.sql";
    const source = readFileSync(resolve("migrations", name), "utf8");
    // The shipped file carries no annotation today, which is exactly why the
    // incident was silent. If a future PR adds one, this test must be
    // re-read rather than rubber-stamped.
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

    expect(verdict.ok).toBe(false);
    const losses = Object.fromEntries(
      verdict.losses.map((loss) => [loss.table, loss.after]),
    );
    expect(losses).toMatchObject({
      user_plan: 0,
      watchlist: 0,
      session: 0,
    });
    // The parent itself keeps its rows in the local seed; prod hit 0 because
    // the scratch-restore path had already been reconciled. The children are
    // the invariant's job and they are caught either way.
    expect(verdict.losses.map((loss) => loss.table).sort()).toEqual([
      "session",
      "user_plan",
      "watchlist",
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
