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
/** The only migration allowed to seed `source` rows today. */
const SEED_FILENAME = "0002_parked_ads_sources.sql";

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
    expect(applied).not.toMatch(/INSERT\s+INTO\s+source\b/i);
  });

  it("seeds the parked rows in their own migration, never in an applied one", async () => {
    // The defect this guards is a source row shipped inside the already-applied
    // file, not "another packet also seeds source rows". Assert that shape and
    // not a whole-tree allowlist: other migrations (e.g. #3977's disabled X
    // row) legitimately seed source rows in their own files, and a test that
    // reddens main for them punishes the correct behaviour. The parked rows
    // themselves must come from SEED_FILENAME, and that is what is asserted.
    const seedSql = await readFile(path.join(MIGRATIONS, SEED_FILENAME), "utf8");
    for (const platform of ["snap", "x", "pinterest", "amazon", "apple"]) {
      expect(seedSql).toContain(`src_ads_${platform}_parked`);
    }
    const applied = await readFile(path.join(MIGRATIONS, APPLIED_FILENAME), "utf8");
    expect(applied).not.toMatch(/INSERT\s+INTO\s+source\b/i);
  });

  it("states the probe evidence the parked rows rest on", async () => {
    // The dates and URLs that make these rows evidence rather than an opinion.
    // Each platform's (url, status) pairs come straight from
    // docs/engines/ads.md probes 12-16. A wrong status in the SQL must fail
    // THIS test — the file-wide toContain pattern that the first version used
    // was masked by the other four rows' 404s (a real defect: snap's URL
    // records 200 in the SQL and the doc, not 404). Asserting each
    // (url, status) pair as a quoted JSON snippet makes a wrong probe red.
    const probes: { platform: string; url: string; status: number | string }[] = [
      { platform: "snap", url: "https://snap.com/political-ads", status: 200 },
      { platform: "snap", url: "https://transparency.snap.com", status: "NXDOMAIN" },
      { platform: "x", url: "https://ads.x.com/ad-repository/search?q=gymshark", status: 404 },
      { platform: "pinterest", url: "https://ads.pinterest.com/ad-library/?q=gymshark", status: 404 },
      { platform: "amazon", url: "https://amazon.com/adlib", status: 404 },
      { platform: "apple", url: "https://ads.apple.com/transparency", status: 404 },
    ];
    const sql = await readFile(path.join(MIGRATIONS, SEED_FILENAME), "utf8");
    for (const { platform, url, status } of probes) {
      expect(sql).toContain(`'ads.${platform}_parked', 'ads', '${platform}', 'ads.${platform}_parked', 'best_effort', 0`);
      // Exact (url, status) pair as it appears in the SQL's JSON. Quoting the
      // status so a JSON number is matched for 200/404 and a JSON string for
      // "NXDOMAIN", which is how the SQL writes it.
      const statusLiteral = typeof status === "number" ? String(status) : `"${status}"`;
      expect(sql).toContain(
        `"url": "${url}",\n           "status": ${statusLiteral}`,
      );
    }
    expect(sql).toContain("2026-09-21T12:14:29Z");
  });
});
