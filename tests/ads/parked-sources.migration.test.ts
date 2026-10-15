import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS = path.resolve(import.meta.dirname, "..", "..", "migrations");

const APPLIED_FILENAME = "0001_rebuild.sql";

const INSERT_INTO_SOURCE = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`[]?source["`\]]?\b/i;

async function parkedSeedFile(): Promise<string> {
  const seeding: string[] = [];
  for (const name of await migrationFiles()) {
    const sql = await readFile(path.join(MIGRATIONS, name), "utf8");
    if (INSERT_INTO_SOURCE.test(sql) && sql.includes("src_ads_snap_parked")) {
      seeding.push(name);
    }
  }
  expect(seeding, "exactly one migration seeds the five parked ad rows; found " + JSON.stringify(seeding)).toHaveLength(
    1,
  );
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

    for (const name of files) {
      expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    }
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(Math.min(...numbers)).toBe(1);

    for (let i = 0; i < numbers.length; i += 1) {
      expect(numbers[i]).toBe(i + 1);
    }
  });

  it("keeps the already-applied migration closed: no new SQL lands in it", async () => {
    for (const name of await migrationFiles()) {
      if (name === APPLIED_FILENAME) continue;
      const sql = await readFile(path.join(MIGRATIONS, name), "utf8");

      expect(sql.trim().length, `${name} is empty`).toBeGreaterThan(0);
    }

    const applied = await readFile(path.join(MIGRATIONS, APPLIED_FILENAME), "utf8");

    expect(applied).not.toMatch(INSERT_INTO_SOURCE);
  });

  it("seeds the parked rows in their own migration, never in an applied one", async () => {
    const seedSql = await readFile(path.join(MIGRATIONS, await parkedSeedFile()), "utf8");
    for (const platform of ["snap", "x", "pinterest", "amazon", "apple"]) {
      expect(seedSql).toContain(`src_ads_${platform}_parked`);
    }
    const applied = await readFile(path.join(MIGRATIONS, APPLIED_FILENAME), "utf8");
    expect(applied).not.toMatch(INSERT_INTO_SOURCE);
  });

  it("states the probe evidence the parked rows rest on", async () => {
    const probes: { id: string; url: string; status: number | string }[] = [
      { id: "src_ads_snap_parked", url: "https://snap.com/political-ads", status: 200 },
      { id: "src_ads_snap_parked", url: "https://transparency.snap.com", status: "NXDOMAIN" },
      { id: "src_ads_x_parked", url: "https://ads.x.com/ad-repository/search?q=gymshark", status: 404 },
      { id: "src_ads_pinterest_parked", url: "https://ads.pinterest.com/ad-library/?q=gymshark", status: 404 },
      { id: "src_ads_amazon_parked", url: "https://amazon.com/adlib", status: 404 },
      { id: "src_ads_apple_parked", url: "https://ads.apple.com/transparency", status: 404 },
    ];
    const sql = await readFile(path.join(MIGRATIONS, await parkedSeedFile()), "utf8");

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

      const platform = id.replace(/^src_ads_|_parked$/g, "");
      expect(block).toContain(
        `'ads.${platform}_parked', 'ads', '${platform}', 'ads.${platform}_parked', 'best_effort', 0`,
      );

      const statusLiteral = typeof status === "number" ? String(status) : `"${status}"`;
      expect(block).toContain(`"url": "${url}",`);
      expect(block).toContain(`"status": ${statusLiteral}`);
    }
    expect(sql).toContain("2026-09-21T12:14:29Z");
  });
});
