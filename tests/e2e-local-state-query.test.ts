import { describe, expect, it } from "vitest";
import { resolveLocalD1DatabasePath } from "../scripts/e2e-local-state-query.mjs";

function entry(name: string, file = true) {
  return {
    name,
    isFile: () => file,
  };
}

describe("local E2E D1 state query", () => {
  it("selects the one D1 object database and ignores Miniflare metadata", () => {
    const path = resolveLocalD1DatabasePath("/repo/.wrangler/e2e-release-run", [
      entry("metadata.sqlite"),
      entry("worker.sqlite"),
      entry("worker.sqlite-wal"),
      entry("nested", false),
    ]);
    expect(path).toBe(
      "/repo/.wrangler/e2e-release-run/v3/d1/miniflare-D1DatabaseObject/worker.sqlite",
    );
  });

  it("fails closed when the isolated D1 database identity is missing or ambiguous", () => {
    expect(() => resolveLocalD1DatabasePath("/repo/.wrangler/e2e-release-run", [
      entry("metadata.sqlite"),
    ])).toThrow("local_d1_database_identity_ambiguous");
    expect(() => resolveLocalD1DatabasePath("/repo/.wrangler/e2e-release-run", [
      entry("one.sqlite"),
      entry("two.sqlite"),
    ])).toThrow("local_d1_database_identity_ambiguous");
  });
});
