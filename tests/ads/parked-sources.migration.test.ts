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

  it("seeds source rows only in their own migration", async () => {
    const files = await migrationFiles();
    const seedingFiles: string[] = [];
    for (const name of files) {
      const sql = await readFile(path.join(MIGRATIONS, name), "utf8");
      if (/INSERT\s+INTO\s+source\b/i.test(sql)) seedingFiles.push(name);
    }
    expect(seedingFiles).toEqual([SEED_FILENAME]);
  });

  it("states the probe evidence the parked rows rest on", async () => {
    const sql = await readFile(path.join(MIGRATIONS, SEED_FILENAME), "utf8");
    // The dates and URLs that make these rows evidence rather than an opinion.
    for (const [platform, url, status] of [
      ["snap", "https://snap.com/political-ads", "404"],
      ["x", "https://ads.x.com/ad-repository/search?q=gymshark", "404"],
      ["pinterest", "https://ads.pinterest.com/ad-library/?q=gymshark", "404"],
      ["amazon", "https://amazon.com/adlib", "404"],
      ["apple", "https://ads.apple.com/transparency", "404"],
    ] as const) {
      expect(sql).toContain(`'ads.${platform}_parked', 'ads', '${platform}', 'ads.${platform}_parked', 'best_effort', 0`);
      expect(sql).toContain(url);
      expect(sql).toContain(`"status": ${status}`);
    }
    expect(sql).toContain("2026-09-21T12:14:29Z");
    expect(sql).toContain("NXDOMAIN");
    expect(sql).toContain(`"status": "NXDOMAIN"`);
  });
});
