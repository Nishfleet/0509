import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const allowedFiles = new Set(["migrations/0060_remove_legacy_billing_provider.sql"]);
function listRepoFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

describe("legacy billing provider removal", () => {
  it("keeps old-provider references out of app, docs, tests, and fresh migrations", () => {
    const needle = "razor" + "pay";
    const offenders = listRepoFiles().filter((filePath) => {
      if (allowedFiles.has(filePath)) {
        return false;
      }

      return readFileSync(filePath, "utf8").toLowerCase().includes(needle);
    });

    expect(offenders).toEqual([]);
  });
});
