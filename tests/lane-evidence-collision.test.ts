import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { isolatedGitEnv } from "./helpers/git-env";

/**
 * Lane evidence records must never share one tracked file.
 *
 * Parallel lanes each append their evidence to the repository. When they all
 * write the same path, every lane's pull request conflicts with every other
 * lane's pull request, and the whole batch dies on merge conflicts instead of
 * on merit. This guard makes that structurally impossible: any file a lane is
 * likely to treat as "the" report file is banned from the tree, so a lane must
 * use a lane-unique path under `.lane/reports/`.
 */
const bannedSharedEvidencePaths = [
  ".lane/report.md",
  ".lane/REPORT.md",
  ".lane/reports.md",
  ".lane/reports/report.md",
  ".lane/reports/README.md",
  "report.md",
  "REPORT.md",
  "docs/status.md",
  "docs/report.md",
];

function listTrackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    env: isolatedGitEnv(),
  })
    .split("\n")
    .filter(Boolean);
}

describe("lane evidence collision guard", () => {
  it("keeps shared lane report files out of the repository", () => {
    const present = new Set(listTrackedFiles());
    const offenders = bannedSharedEvidencePaths.filter((candidate) => present.has(candidate));

    expect(
      offenders,
      "Shared lane evidence files force every parallel lane's PR to conflict. " +
        "Write evidence to .lane/reports/<branch-name>.md instead.",
    ).toEqual([]);
  });

  it("keeps every lane evidence record in its own markdown file", () => {
    const records = listTrackedFiles().filter((filePath) => filePath.startsWith(".lane/reports/"));
    const malformed = records.filter((filePath) => {
      const name = filePath.slice(".lane/reports/".length);
      // No nested directories, markdown only, and a name long enough to be
      // branch-derived rather than a generic shared bucket.
      return name.includes("/") || !name.endsWith(".md") || name.length <= "record.md".length;
    });

    expect(
      malformed,
      "Lane evidence records must be flat, markdown, lane-unique files under .lane/reports/.",
    ).toEqual([]);
  });
});
