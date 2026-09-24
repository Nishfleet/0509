import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

// #4836: on 2026-09-24 four open PRs each added a `0012_*.sql` while main already
// had `0012_drop_legacy_tables.sql`. Wrangler applies migrations by filename, so
// two files sharing a number apply in an order nobody chose. The merge queue tests
// the merge result, so this test turns that clash red there and sends the claim PR
// back to its worker to renumber instead of letting both land.
const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

const NAMES = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

describe("migration filenames", () => {
  it("every migration is named NNNN_snake_case.sql", () => {
    const malformed = NAMES.filter((name) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name));
    expect(malformed).toEqual([]);
  });

  it("migration numbers run 1..N with no duplicate or gap", () => {
    const numbers = NAMES.map((name) => Number(name.slice(0, 4)));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });
});
