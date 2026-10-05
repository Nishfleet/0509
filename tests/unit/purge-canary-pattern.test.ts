import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(REPO_ROOT, "migrations");
const ANY_DOMAIN_CANARY = /email LIKE ['"]canary%['"]/;

describe("purge migrations after 0044", () => {
  it("do not match canary* on any domain (0509#7080)", async () => {
    const names = (await readdir(MIGRATIONS)).filter((name) => name.endsWith(".sql")).sort();
    const later = names.filter((name) => name.slice(0, 4) > "0044");
    expect(later.length).toBeGreaterThan(0);
    for (const name of later) {
      const sql = await readFile(path.join(MIGRATIONS, name), "utf8");
      expect(sql, name).not.toMatch(ANY_DOMAIN_CANARY);
    }
  });
});
