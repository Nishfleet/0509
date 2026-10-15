import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
