import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

// The /changelog page is a public trust surface for a product whose pitch is
// "we tell you what changed." A stale changelog undercuts that promise. This
// test fails when the latest dated entry in app/routes/changelog.tsx falls
// more than STALE_DAYS behind the latest commit on the current branch, so the
// next CI run after the changelog goes stale forces an update instead of
// shipping a quiet regression for the fourth time (issues #1099, #1458, #1763).
const CHANGELOG_PATH = "app/routes/changelog.tsx";
const STALE_DAYS = 7;
const DATE_RE = /<PublicDocBlock\s+title="(\d{4}-\d{2}-\d{2})">/g;

function latestChangelogDate(): Date {
  const source = readFileSync(CHANGELOG_PATH, "utf8");
  const dates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = DATE_RE.exec(source)) !== null) {
    dates.push(match[1]);
  }
  if (dates.length === 0) {
    throw new Error(
      `No <PublicDocBlock title="YYYY-MM-DD"> entries found in ${CHANGELOG_PATH}`,
    );
  }
  dates.sort();
  const latest = dates[dates.length - 1];
  // Parse as a UTC midnight so the comparison is timezone-stable. The changelog
  // dates are calendar dates, not instants, so a local parse would shift the
  // boundary by the runner's UTC offset and flake near midnight.
  return new Date(`${latest}T00:00:00.000Z`);
}

function latestCommitDate(): Date {
  // %cI is the committer date in strict ISO 8601. It is the date the commit
  // was created on the current machine, which is what matters for "how long
  // has the repo been ahead of the changelog."
  const result = spawnSync("git", ["log", "-1", "--format=%cI"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git log failed (status ${result.status}): ${result.stderr}`,
    );
  }
  const iso = result.stdout.trim();
  if (!iso) {
    throw new Error("git log returned an empty commit date");
  }
  return new Date(iso);
}

describe("changelog staleness", () => {
  it("the latest changelog entry is within 7 days of the latest commit", () => {
    const changelogLatest = latestChangelogDate();
    const commitLatest = latestCommitDate();
    const diffMs = commitLatest.getTime() - changelogLatest.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    expect(
      diffDays,
      `Changelog latest entry is ${changelogLatest.toISOString().slice(0, 10)}, ` +
        `latest commit is ${commitLatest.toISOString().slice(0, 10)} ` +
        `(${diffDays.toFixed(1)} days behind, stale at >${STALE_DAYS}). ` +
        `Add a dated <PublicDocBlock title="YYYY-MM-DD"> entry to ` +
        `${CHANGELOG_PATH} covering the customer-visible changes since the ` +
        `latest entry.`,
    ).toBeLessThanOrEqual(STALE_DAYS);
  });

  it("the changelog carries at least one dated entry", () => {
    expect(latestChangelogDate().toString()).not.toBe("Invalid Date");
  });
});
