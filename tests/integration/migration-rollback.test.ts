import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * docs/REBUILD-SCHEMA.md "When a migration is wrong" — the additive half,
 * proven in real workerd against real local D1. D1 migrations are
 * forward-only and tracked by filename in d1_migrations, so the way back
 * from a wrong additive file is a newer file that undoes it, never an
 * un-apply. The setup file has already applied the real chain, so the
 * "before" snapshot below is the intended production schema.
 *
 * Issue #4180. The file carries no `.integration.` infix because the
 * issue's acceptance names `tests/integration/migration-rollback.test.ts`
 * verbatim; vitest.config.ts lists it in the workers project explicitly.
 */

const SCHEMA_DUMP = `SELECT type, name, tbl_name, sql FROM sqlite_master
  WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'
  ORDER BY type, name`;

const WRONG = {
  name: "0003_wrong_additive.sql",
  queries: ["ALTER TABLE signal ADD COLUMN accidental_metric TEXT"],
};
const CORRECTIVE = {
  name: "0004_corrective.sql",
  queries: ["ALTER TABLE signal DROP COLUMN accidental_metric"],
};

interface SchemaRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string;
}

async function schemaDump(): Promise<SchemaRow[]> {
  const { results } = await env.DB.prepare(SCHEMA_DUMP).all<SchemaRow>();
  return results ?? [];
}

async function appliedNames(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM d1_migrations ORDER BY name",
  ).all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

async function columnNames(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM pragma_table_info('${table}')`,
  ).all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

describe("a wrong migration has a proven way back", () => {
  it("an additive wrong is reversed by a newer forward migration", async () => {
    const before = await schemaDump();
    console.log(`sqlite_master before (${before.length} objects):`);
    console.log(JSON.stringify(before, null, 2));

    await applyD1Migrations(env.DB, [WRONG]);
    expect(await columnNames("signal")).toContain("accidental_metric");
    expect(await appliedNames()).toContain(WRONG.name);

    await applyD1Migrations(env.DB, [CORRECTIVE]);
    const after = await schemaDump();
    console.log(`sqlite_master after corrective (${after.length} objects):`);
    console.log(JSON.stringify(after, null, 2));
    expect(after).toEqual(before);
    expect(await appliedNames()).toContain(CORRECTIVE.name);

    await applyD1Migrations(env.DB, [WRONG]);
    expect(await columnNames("signal")).not.toContain("accidental_metric");
  });
});
