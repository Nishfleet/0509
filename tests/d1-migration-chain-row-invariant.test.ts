import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  evaluateMigrationRowInvariant,
  formatRowCountDiff,
  parseExpectsRowLoss,
  readTableRowCounts,
} from "../scripts/d1-migration-row-invariant.mjs";

/**
 * PR-side half of issue #2779. Before this file existed, a destructive
 * migration was only discovered when it reached production: on 2026-09-09
 * migration 0087 rebuilt `user`, `PRAGMA foreign_keys = OFF` turned out to be
 * a no-op inside D1's migration transaction, and 55 ON DELETE CASCADE
 * children emptied with it (fleet-ops#4999).
 *
 * This runs the repo's real `migrations/*.sql` chain, in order, one file per
 * transaction with foreign key enforcement ON (mirroring D1's execution
 * shape, which is why 0087's PRAGMA could not disable the cascades), and
 * applies the same per-table row-count invariant the production dry run
 * applies.
 *
 * It lives in the node vitest project, which every PR runs unconditionally,
 * so `migrations/**` gets a required check without a path filter that could
 * itself rot. The expensive workerd integration suite is untouched.
 */

const root = mkdtempSync(join(tmpdir(), "0509-migration-chain-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface MigrationLoss {
  migration: string;
  tables: string[];
}

/**
 * Apply the whole repository chain to one database, seeding `seedSql` right
 * before `seedBefore` is applied. Seeding at a fixed point is what makes the
 * incident reproducible: it proves the invariant fires on 0087 with rows
 * present, rather than on an empty schema where nothing can be lost.
 */
function applyChain({
  seedBefore,
  seedSql,
}: {
  seedBefore?: string;
  seedSql?: string;
}): {
  losses: MigrationLoss[];
  applied: string[];
  failed: Array<{ migration: string; message: string }>;
} {
  const databasePath = join(root, `chain-${seedBefore ?? "none"}.sqlite`);
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
  });
  const losses: MigrationLoss[] = [];
  const applied: string[] = [];
  const failed: Array<{ migration: string; message: string }> = [];
  try {
    database.exec(
      `CREATE TABLE d1_migrations (
         id INTEGER PRIMARY KEY,
         name TEXT NOT NULL UNIQUE,
         applied_at TEXT NOT NULL DEFAULT ''
       );`,
    );
    const names = readdirSync(resolve("migrations"))
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort();
    for (const name of names) {
      if (seedBefore === name && seedSql) {
        database.exec(seedSql);
      }
      const before = readTableRowCounts(databasePath);
      const sql = readFileSync(resolve("migrations", name), "utf8");
      let appliedCleanly = true;
      database.exec("BEGIN");
      try {
        database.exec(sql);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        appliedCleanly = false;
        failed.push({
          migration: name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (!appliedCleanly) continue;
      applied.push(name);
      const after = readTableRowCounts(databasePath);
      const verdict = evaluateMigrationRowInvariant({
        before,
        after,
        // The annotation comes from the file under test, so a migration that
        // declares its row loss passes and a silent one does not.
        expectedRowLossByMigration: new Map([
          [name, parseExpectsRowLoss(sql)],
        ]),
      });
      if (!verdict.ok) {
        losses.push({
          migration: name,
          tables: verdict.losses.map((loss) => loss.table).sort(),
        });
      }
    }
  } finally {
    database.close();
  }
  return { losses, applied, failed };
}

describe("migration chain row-count invariant (issue #2779)", () => {
  it("every migration in the repository chain applies cleanly", () => {
    const { failed, applied } = applyChain({});
    expect(failed).toEqual([]);
    // Guard against a silently empty chain: readdir of the wrong directory
    // would otherwise make this whole file vacuous.
    expect(applied.length).toBeGreaterThan(50);
    expect(applied).toContain("0087_signup_source_open_allowlist.sql");
  });

  it("the real chain reports expected row loss for 0087 and nothing else, with rows seeded", () => {
    const { losses, failed } = applyChain({
      seedBefore: "0087_signup_source_open_allowlist.sql",
      seedSql: `
        INSERT INTO user (id, name, email, createdAt, updatedAt)
          VALUES ('u1', 'A', 'a@example.com', '2026-01-01', '2026-01-01'),
                 ('u2', 'B', 'b@example.com', '2026-01-01', '2026-01-01');
        INSERT INTO user_plan (user_id, plan)
          VALUES ('u1', 'free'), ('u2', 'free');
        INSERT INTO watchlist (
          id, user_id, name, target_type, target_id, target_fingerprint,
          target_label, created_at, updated_at
        ) VALUES (
          'w1', 'u1', 'One', 'advertiser', 'a-1', 'fp-1', 'One',
          '2026-01-01', '2026-01-01'
        );
      `,
    });
    expect(failed).toEqual([]);

    // 0087 is the fleet-ops#4999 signature and must be named. This assertion
    // is the one that goes red until #2774 rewrites the file; it is not a
    // rubber stamp, it is the incident reproduced.
    const byMigration = new Map(
      losses.map((loss) => [loss.migration, loss.tables]),
    );
    expect(byMigration.get("0087_signup_source_open_allowlist.sql")).toEqual([
      "user_plan",
      "watchlist",
    ]);
    // No OTHER migration in the chain may quietly lose rows.
    expect(
      losses
        .filter((loss) => loss.migration !== "0087_signup_source_open_allowlist.sql")
        .map((loss) => loss.migration),
    ).toEqual([]);
  });

  it("a destructive rebuild injected into the chain is caught by the same invariant", () => {
    // The fixture shape the issue asks for: drop-and-recreate a parent table
    // with cascading children. Proving it here proves the invariant is what
    // catches it, independent of which real migration happens to be bad today.
    const databasePath = join(root, "injected.sqlite");
    const database = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
    });
    database.exec(`
      CREATE TABLE parent (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL);
      CREATE TABLE child (
        id TEXT PRIMARY KEY NOT NULL,
        parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE
      );
      INSERT INTO parent (id, label) VALUES ('p1', 'one'), ('p2', 'two');
      INSERT INTO child (id, parent_id) VALUES ('c1', 'p1'), ('c2', 'p2');
    `);
    const before = readTableRowCounts(databasePath);
    database.exec("BEGIN");
    database.exec(`
      CREATE TABLE parent_new (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL);
      INSERT INTO parent_new (id, label) SELECT id, label FROM parent;
      DROP TABLE parent;
      ALTER TABLE parent_new RENAME TO parent;
    `);
    database.exec("COMMIT");
    const after = readTableRowCounts(databasePath);
    database.close();

    const allowed = evaluateMigrationRowInvariant({ before, after });
    expect(allowed.ok).toBe(false);
    expect(allowed.losses.map((loss) => loss.table)).toEqual(["child"]);
    expect(formatRowCountDiff({ before, after })).toContain(
      "| child | 2 | 0 | -2 |",
    );

    // The identical migration WITH the annotation passes.
    const excused = evaluateMigrationRowInvariant({
      before,
      after,
      expectedRowLossByMigration: new Map([
        ["9000_rebuild.sql", parseExpectsRowLoss("-- expects-row-loss: child\n")],
      ]),
    });
    expect(excused.ok).toBe(true);
  });
});
