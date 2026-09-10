/**
 * Behaviour of the migration-numbering gate (detector for #2507).
 *
 * A duplicate migration number took every production deploy down and nothing
 * caught it at PR time. This gate blocks a PR whose newly added migration does
 * not sort after every migration on the base branch. The interesting cases are
 * all the ones where it must say no, plus the ones where historical duplicates
 * already on the base branch must NOT trip it.
 */
import { describe, expect, it } from "vitest";

const {
  GateRefusal,
  checkMigrationNumbering,
  listBaseMigrations,
  listAddedMigrations,
  baseTopPrefix,
  migrationPrefix,
} = await import("../scripts/check-migration-numbering.mjs");

/** Build an executor from a map of command-prefix patterns to results. */
function execFrom(handlers: Array<[RegExp, { status: number; stdout?: string; stderr?: string }]>) {
  return (command: string, args: string[]) => {
    const line = `${command} ${args.join(" ")}`;
    for (const [pattern, result] of handlers) {
      if (pattern.test(line)) {
        return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      }
    }
    throw new Error(`unexpected command in test: ${line}`);
  };
}

const baseMigrations = (files: string[]): [RegExp, any] => [
  /^git ls-tree/u,
  { status: 0, stdout: files.join("\n") },
];

const addedMigrations = (files: string[]): [RegExp, any] => [
  /^git diff --name-only/u,
  { status: 0, stdout: files.join("\n") },
];

describe("migrationPrefix", () => {
  it("reads the 4-digit prefix of a migration path", () => {
    expect(migrationPrefix("migrations/0090_new.sql")).toBe(90);
    expect(migrationPrefix("0089_org_scoped_ownership.sql")).toBe(89);
  });

  it("ignores non-sql files and non-conforming names", () => {
    expect(migrationPrefix("migrations/README.md")).toBeNull();
    expect(migrationPrefix("migrations/notes.txt")).toBeNull();
    expect(migrationPrefix("migrations/foo.sql")).toBeNull();
  });
});

describe("baseTopPrefix", () => {
  it("returns the highest numbered migration on the base branch", () => {
    expect(
      baseTopPrefix(
        execFrom([
          baseMigrations([
            "migrations/0001_app.sql",
            "migrations/0088_competitor_source_fields.sql",
            "migrations/0088_recreate_delivery_hot_path_indexes.sql",
            "migrations/0089_org_scoped_ownership.sql",
          ]),
        ]),
      ),
    ).toBe(89);
  });

  it("returns -1 when the base branch has no numbered migrations", () => {
    expect(
      baseTopPrefix(execFrom([baseMigrations(["migrations/README.md"])])),
    ).toBe(-1);
  });

  it("refuses when the base branch cannot be read", () => {
    expect(() =>
      baseTopPrefix(
        execFrom([[/^git ls-tree/u, { status: 128, stderr: "bad ref origin/main" }]]),
      ),
    ).toThrow(/Could not list migrations/u);
  });
});

describe("listAddedMigrations", () => {
  it("diffs against the merge base with origin/main for added files", () => {
    let seen: string[] | undefined;
    const exec = (command: string, args: string[]) => {
      seen = [command, ...args];
      return { status: 0, stdout: "migrations/0090_new.sql", stderr: "" };
    };
    listAddedMigrations(exec);
    expect(seen).toEqual([
      "git",
      "diff", "--name-only", "--diff-filter=A", "origin/main...HEAD", "--", "migrations",
    ]);
  });

  it("refuses when the diff fails", () => {
    expect(() =>
      listAddedMigrations(
        execFrom([[/^git diff --name-only/u, { status: 128, stderr: "boom" }]]),
      ),
    ).toThrow(/Could not list migrations added/u);
  });
});

describe("checkMigrationNumbering", () => {
  it("passes a migration that sorts after the base branch top", () => {
    const result = checkMigrationNumbering(
      execFrom([
        baseMigrations([
          "migrations/0088_competitor_source_fields.sql",
          "migrations/0088_recreate_delivery_hot_path_indexes.sql",
          "migrations/0089_org_scoped_ownership.sql",
        ]),
        addedMigrations(["migrations/0090_next.sql"]),
      ]),
    );
    expect(result).toEqual({ ok: true, added: ["migrations/0090_next.sql"], baseTop: 89 });
  });

  it("fails a migration duplicating the top number", () => {
    let refusal: any;
    try {
      checkMigrationNumbering(
        execFrom([
          baseMigrations(["migrations/0089_org_scoped_ownership.sql"]),
          addedMigrations(["migrations/0089_dupe.sql"]),
        ]),
      );
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(GateRefusal);
    expect(refusal.reason).toBe("migration_not_sorting_last");
    expect(refusal.detail).toContain("migrations/0089_dupe.sql");
    expect(refusal.detail).toContain("0089");
  });

  it("fails a migration below the top number", () => {
    let refusal: any;
    try {
      checkMigrationNumbering(
        execFrom([
          baseMigrations(["migrations/0089_org_scoped_ownership.sql"]),
          addedMigrations(["migrations/0001_dupe.sql"]),
        ]),
      );
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(GateRefusal);
    expect(refusal.reason).toBe("migration_not_sorting_last");
    expect(refusal.detail).toContain("migrations/0001_dupe.sql");
  });

  it("passes a PR that touches no migrations", () => {
    const result = checkMigrationNumbering(
      execFrom([
        baseMigrations(["migrations/0089_org_scoped_ownership.sql"]),
        addedMigrations([]),
      ]),
    );
    expect(result).toEqual({ ok: true, added: [], baseTop: 89 });
  });

  it("fails two added migrations that duplicate each other's prefix above the base top", () => {
    let refusal: any;
    try {
      // base tops at 0089; both 0090_a and 0090_b sort after the base, so the
      // sort-last rule alone lets them through — but they recreate the exact
      // duplicate-number incident inside one PR.
      checkMigrationNumbering(
        execFrom([
          baseMigrations(["migrations/0089_org_scoped_ownership.sql"]),
          addedMigrations(["migrations/0090_a.sql", "migrations/0090_b.sql"]),
        ]),
      );
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(GateRefusal);
    expect(refusal.reason).toBe("migration_not_sorting_last");
    expect(refusal.detail).toContain("0090 used by both");
    expect(refusal.detail).toContain("migrations/0090_a.sql");
    expect(refusal.detail).toContain("migrations/0090_b.sql");
  });

  it("passes two distinct added migrations above the base top", () => {
    const result = checkMigrationNumbering(
      execFrom([
        baseMigrations(["migrations/0089_org_scoped_ownership.sql"]),
        addedMigrations(["migrations/0090_a.sql", "migrations/0091_b.sql"]),
      ]),
    );
    expect(result).toEqual({
      ok: true,
      added: ["migrations/0090_a.sql", "migrations/0091_b.sql"],
      baseTop: 89,
    });
  });

  it("does not trip on historical duplicates already on the base branch", () => {
    // 0088 is duplicated on the base branch (the real-world state). A new
    // 0090 must pass — the duplicates are not "added in this PR".
    const result = checkMigrationNumbering(
      execFrom([
        baseMigrations([
          "migrations/0088_competitor_source_fields.sql",
          "migrations/0088_recreate_delivery_hot_path_indexes.sql",
          "migrations/0089_org_scoped_ownership.sql",
        ]),
        addedMigrations(["migrations/0090_next.sql"]),
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it("names every offending file when several are added out of order", () => {
    let refusal: any;
    try {
      checkMigrationNumbering(
        execFrom([
          baseMigrations(["migrations/0089_org_scoped_ownership.sql"]),
          addedMigrations(["migrations/0001_a.sql", "migrations/0089_b.sql"]),
        ]),
      );
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(GateRefusal);
    expect(refusal.detail).toContain("migrations/0001_a.sql");
    expect(refusal.detail).toContain("migrations/0089_b.sql");
  });

  it("ignores a non-numbered file added under migrations/", () => {
    const result = checkMigrationNumbering(
      execFrom([
        baseMigrations(["migrations/0089_org_scoped_ownership.sql"]),
        addedMigrations(["migrations/README.md"]),
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it("never reports success when the base branch cannot be resolved", () => {
    expect(() =>
      checkMigrationNumbering(
        execFrom([[/^git ls-tree/u, { status: 128, stderr: "no ref" }]]),
      ),
    ).toThrow(GateRefusal);
  });
});
