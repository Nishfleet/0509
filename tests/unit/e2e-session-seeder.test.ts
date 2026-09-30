import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../e2e");
const SEEDER = "inbox.ts";
const SECOND_SEEDER = /new DatabaseSync\(|betterAuth\(/;

describe("e2e session seeder (0509#6001)", () => {
  it("lives in e2e/inbox.ts and nowhere else", () => {
    const files = readdirSync(E2E_DIR, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".ts"));
    const offenders = files.filter(
      (name) => name !== SEEDER && SECOND_SEEDER.test(readFileSync(path.join(E2E_DIR, name), "utf8")),
    );
    expect(offenders).toEqual([]);
    expect(SECOND_SEEDER.test(readFileSync(path.join(E2E_DIR, SEEDER), "utf8"))).toBe(true);
  });
});
