import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Migration-file discipline, rung 2 of the mechanical fix (#4039).
 *
 * The defect this guards against was shipped in this issue's own first attempt:
 * the five parked `source` rows were appended to `migrations/0001_rebuild.sql`,
 * a file production applied on 2026-09-21T12:44:35Z. `wrangler d1 migrations
 * apply` tracks by filename (docs/REBUILD-SCHEMA.md §103), so every later deploy
 * logged "No migrations to apply" and the rows existed in the local test D1 and
 * nowhere else — a green test over a schema production never received.
 *
 * Nothing in CI can see that: every run builds a fresh D1 where the appended
 * section does execute. The only place the mistake is visible is the file
 * itself, so the gate reads the files.
 *
 * Rule here, matching Nish's note on #4039 (2026-09-22T12:32:53Z) and
 * docs/REBUILD-SCHEMA.md: 0001_rebuild.sql is closed once applied — a source row
 * ships in its own 00NN_<slug>.sql, and no two packets fold into one file.
 */

const MIGRATIONS = path.resolve(import.meta.dirname, "..", "..", "migrations");
/** The migration production has already applied and must never gain SQL again. */
const APPLIED_FILENAME = "0001_rebuild.sql";
/**
 * A `source` INSERT statement, however its table name is quoted. `INSERT INTO
 * source` and `INSERT INTO "source"` are the same statement to SQLite, so the
 * guard must catch both. Matches `INSERT OR IGNORE/REPLACE INTO` too.
 */
const INSERT_INTO_SOURCE = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`[]?source["`\]]?\b/i;

/**
 * The filename is resolved by content, never hardcoded. Nish's numbering rule
 * on #4039 says a file at the same number as an in-flight packet is renamed on
 * merge conflict, so a name pinned here would ENOENT the moment #3977/#3969/
 * #3905 renumbers this one. Resolve whichever migration seeds the parked rows
 * and let the renumber be a pure rename.
 */
async function parkedSeedFile(): Promise<string> {
  const seeding: string[] = [];
  for (const name of await migrationFiles()) {
    const sql = await readFile(path.join(MIGRATIONS, name), "utf8");
    if (INSERT_INTO_SOURCE.test(sql) && sql.includes("src_ads_snap_parked")) {
      seeding.push(name);
    }
  }
  expect(
    seeding,
    "exactly one migration seeds the five parked ad rows; found " + JSON.stringify(seeding),
  ).toHaveLength(1);
  return seeding[0];
}

async function migrationFiles(): Promise<string[]> {
  const names = await readdir(MIGRATIONS);
  return names.filter((n) => n.endsWith(".sql")).sort();
}

describe("migration file discipline", () => {
  it("applies the chain in a single ordered sequence with no gaps or duplicates", async () => {
    const files = await migrationFiles();
    expect(files.length).toBeGreaterThan(0);

    const numbers = files.map((n) => Number.parseInt(n.slice(0, 4), 10));
    // Every file is zero-padded to four digits, so sort order is apply order and
    // a duplicate number means two packets claimed the same slot.
    for (const name of files) {
      expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    }
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(Math.min(...numbers)).toBe(1);
    // Contiguous from 1: wrangler applies in filename order and a gap means a
    // file a previous PR renamed away is still expected by the migrations table.
    for (let i = 0; i < numbers.length; i += 1) {
      expect(numbers[i]).toBe(i + 1);
    }
  });

  it("keeps the already-applied migration closed: no new SQL lands in it", async () => {
    // `wrangler d1 migrations apply` tracks by filename. An edit to a file the
    // migrations table already records never runs again, so appending to it
    // ships code to the test database and nothing to production.
    for (const name of await migrationFiles()) {
      if (name === APPLIED_FILENAME) continue;
      const sql = await readFile(path.join(MIGRATIONS, name), "utf8");
      // A migration must not try to rebuild another packet's file's job.
      expect(sql.trim().length, `${name} is empty`).toBeGreaterThan(0);
    }

    const applied = await readFile(path.join(MIGRATIONS, APPLIED_FILENAME), "utf8");
    // The applied file's own DROP/CREATE statements are fine — they are what it
    // did. What must never appear again is a row INSERT into source: that is
    // this issue's original defect, verbatim.
    expect(applied).not.toMatch(INSERT_INTO_SOURCE);
  });

  it("seeds the parked rows in their own migration, never in an applied one", async () => {
    // The defect this guards is a source row shipped inside the already-applied
    // file, not "another packet also seeds source rows". Assert that shape and
    // not a whole-tree allowlist: other migrations (e.g. #3977's disabled X
    // row) legitimately seed source rows in their own files, and a test that
    // reddens main for them punishes the correct behaviour. The parked rows
    // themselves must come from one migration, and that is what is asserted.
    const seedSql = await readFile(path.join(MIGRATIONS, await parkedSeedFile()), "utf8");
    for (const platform of ["snap", "x", "pinterest", "amazon", "apple"]) {
      expect(seedSql).toContain(`src_ads_${platform}_parked`);
    }
    const applied = await readFile(path.join(MIGRATIONS, APPLIED_FILENAME), "utf8");
    expect(applied).not.toMatch(INSERT_INTO_SOURCE);
  });

  it("states the probe evidence the parked rows rest on", async () => {
    // The dates and URLs that make these rows evidence rather than an opinion.
    // Each platform's (url, status) pairs come straight from
    // docs/engines/ads.md probes 12-16.
    //
    // Each probe is asserted INSIDE its own row's slice, not against the whole
    // file. Two defects in this gate's own lineage are why: (a) a file-wide
    // check let the other four rows' 404s mask snap's 200, so a wrong status
    // could not fail; (b) a file-wide check cannot see a probe moved to another
    // platform's row. Slicing the SQL at each row id ties a probe to its row.
    const probes: { id: string; url: string; status: number | string }[] = [
      { id: "src_ads_snap_parked", url: "https://snap.com/political-ads", status: 200 },
      { id: "src_ads_snap_parked", url: "https://transparency.snap.com", status: "NXDOMAIN" },
      { id: "src_ads_x_parked", url: "https://ads.x.com/ad-repository/search?q=gymshark", status: 404 },
      { id: "src_ads_pinterest_parked", url: "https://ads.pinterest.com/ad-library/?q=gymshark", status: 404 },
      { id: "src_ads_amazon_parked", url: "https://amazon.com/adlib", status: 404 },
      { id: "src_ads_apple_parked", url: "https://ads.apple.com/transparency", status: 404 },
    ];
    const sql = await readFile(path.join(MIGRATIONS, await parkedSeedFile()), "utf8");

    // Slice the file into one block per parked row: from the row's id up to the
    // next row's id (or EOF). The last slice is the final row.
    const ids = [...new Set(probes.map((p) => p.id))];
    const starts = ids
      .map((id) => ({ id, at: sql.indexOf(`('${id}'`) }))
      .filter((s) => s.at >= 0)
      .sort((a, b) => a.at - b.at);
    expect(starts, "every parked row id must appear in the seed migration").toHaveLength(ids.length);
    const blockFor = (id: string): string => {
      const i = starts.findIndex((s) => s.id === id);
      const from = starts[i].at;
      const to = i + 1 < starts.length ? starts[i + 1].at : sql.length;
      return sql.slice(from, to);
    };

    for (const { id, url, status } of probes) {
      const block = blockFor(id);
      // The row tuple: kind, platform and is_enabled live in the same block.
      const platform = id.replace(/^src_ads_|_parked$/g, "");
      expect(block).toContain(`'ads.${platform}_parked', 'ads', '${platform}', 'ads.${platform}_parked', 'best_effort', 0`);
      // Exact (url, status) pair as it appears in the SQL's JSON, inside this
      // row's slice. Quoting the status so a JSON number is matched for 200/404
      // and a JSON string for "NXDOMAIN", which is how the SQL writes it.
      const statusLiteral = typeof status === "number" ? String(status) : `"${status}"`;
      expect(block).toContain(`"url": "${url}",`);
      expect(block).toContain(`"status": ${statusLiteral}`);
    }
    expect(sql).toContain("2026-09-21T12:14:29Z");
  });
});
