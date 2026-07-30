import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isolatedGitEnv } from "./helpers/git-env";

const allowedFiles = new Set(["migrations/0060_remove_legacy_billing_provider.sql"]);
const allowedHistoricalReferences = new Map([
  [
    "scripts/d1-migration-sync-check.lib.mjs",
    [
      '"0010_' + "razor" + 'pay_billing.sql"',
      '"0013_' + "razor" + 'pay_webhook_events.sql"',
    ],
  ],
]);
function listRepoFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    env: isolatedGitEnv(),
  })
    .split("\n")
    .filter(Boolean);
}

describe("legacy billing provider removal", () => {
  it("keeps old-provider references out of app, docs, tests, and fresh migrations", () => {
    const needle = "razor" + "pay";
    const offenders = listRepoFiles().filter((filePath) => {
      if (allowedFiles.has(filePath) || !existsSync(filePath)) {
        return false;
      }

      let contents = readFileSync(filePath, "utf8");
      for (const reference of allowedHistoricalReferences.get(filePath) ?? []) {
        contents = contents.replaceAll(reference, "");
      }
      return contents.toLowerCase().includes(needle);
    });

    expect(offenders).toEqual([]);
  });
});
