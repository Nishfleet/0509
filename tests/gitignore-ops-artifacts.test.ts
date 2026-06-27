import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("ops artifact ignores", () => {
  const gitignore = readFileSync(".gitignore", "utf8");

  it("keeps restore drill exports and local databases out of git", () => {
    expect(gitignore).toContain("/backups/");
    expect(gitignore).toContain("/restore.sql");
    expect(gitignore).toContain("/restore.sqlite");
  });
});
