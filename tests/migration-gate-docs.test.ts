import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// #7003: .github/CODEOWNERS and the house-rules file both told the next agent
// that `/migrations/` "waits for a code-owner review", and CODEOWNERS:2 said the
// no-glue lock "uses CODEOWNERS + require_code_owner_review". Ruleset 21391031
// is the only ruleset on this branch (branch protection returns 404) and its
// pull_request params are `require_code_owner_review:false` and
// `required_approving_review_count:0`, so neither lock enforced anything:
// #6988, #6970 and #6927 all merged with zero reviews. #5787 closed the ruleset
// change with the reason a code-owner lock here can never work at all — every PR
// the fleet opens is authored by nish3451, and GitHub never lets an author
// approve their own PR.
//
// 0509#7005 moved the house rules from CLAUDE.md into AGENTS.md; CLAUDE.md is
// now only `@AGENTS.md`. The gate this repo actually has, which the docs now
// say: a worker PR that touches `migrations/` is outside the fleet-ops
// `agent.yml` arm allowlist, so it gets `needs-coordinator` and is never
// auto-armed, and every merge rides the merge queue's four required checks.
// This is the same shape as tests/required-checks-never-skip.test.ts: a doc
// line that re-claims a lock the ruleset does not have turns red here, instead
// of sending the next agent to trust a gate that never runs.

const CODEOWNERS = new URL("../.github/CODEOWNERS", import.meta.url);
const AGENTS = new URL("../AGENTS.md", import.meta.url);

const read = (url: URL): string => readFileSync(url, "utf8");

// The ruleset parameter that would enforce ownership, and the phrase the docs use
// for the review it is supposed to require.
const OWNERSHIP = /code[-_ ]owner review|require_code_owner_review/i;

// A line that names ownership and does not deny it on the same line claims a lock.
// The three truthful shapes each carry their denial with them: the ruleset
// parameter with its real value (`require_code_owner_review:false`), a negation
// ("No code-owner review stands in front of it", "not a code-owner review"), or a
// phrase that says the lock cannot work ("GitHub never lets an author approve
// their own PR").
const DENIES = /:false|\bn(?:o|ot|ever|either|or)\b|n't/i;

/** Every line that claims a lock this repo's ruleset does not enforce. */
function falseLocks(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && OWNERSHIP.test(line) && !DENIES.test(line));
}

// The gate a worker PR that touches a locked path really has.
const NAMES_REAL_GATE = /needs-coordinator/;

// The lock text as it read before this fix, pasted verbatim so the probe cannot
// drift with the real files.
const CODEOWNERS_BEFORE = `# No-glue lock (fleet-ops#8459): scripts, wrappers and script dirs need Nish's review to merge.
# Push rulesets are refused on public repos, so this uses CODEOWNERS + require_code_owner_review.
*.sh @nish3451

# Migration lock: merging to main applies migrations/ to production D1
# (deploy-production.yml), so a migration waits for a code-owner review
# instead of riding a worker's auto-merge.
/migrations/ @nish3451
`;

const AGENTS_BEFORE = `- Migrations (Nish 2026-09-24: "this is allowed too, use your best
  judgement"): a merge to \`main\` applies them to production D1, so
  \`/migrations/\` is code-owned and needs a code-owner review before merge.
`;

/**
 * The CODEOWNERS block that owns `pattern`: its comment lines and the owner line
 * itself, so a claim is caught only where it is made.
 */
function ownersBlock(text: string, pattern: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim() === pattern);
  if (at === -1) return "";
  let start = at;
  while (start > 0 && lines[start - 1].trim().startsWith("#")) start -= 1;
  return lines.slice(start, at + 1).join("\n");
}

/** The list item that opens with `opener`, through the rest of its lines. */
function listItem(text: string, opener: RegExp): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => opener.test(line));
  if (at === -1) return "";
  let end = at + 1;
  while (end < lines.length && !/^[-*] /.test(lines[end] ?? "")) end += 1;
  return lines.slice(at, end).join("\n");
}

describe("the migration and no-glue locks state the gate this repo has (0509#7003)", () => {
  it("claims no gate in .github/CODEOWNERS that ruleset 21391031 does not enforce", () => {
    expect(falseLocks(read(CODEOWNERS))).toEqual([]);
  });

  it("claims no gate in AGENTS.md that ruleset 21391031 does not enforce", () => {
    expect(falseLocks(read(AGENTS))).toEqual([]);
  });

  it("names needs-coordinator as the migration's gate, in both entry docs", () => {
    expect(ownersBlock(read(CODEOWNERS), "/migrations/ @nish3451")).toMatch(NAMES_REAL_GATE);
    expect(listItem(read(AGENTS), /^- Migrations \(/)).toMatch(NAMES_REAL_GATE);
  });

  // The pair. Without this the block above could pass by accident — on an empty
  // file, or after the phrase was renamed — and the mistake would come back.
  it("fails the same text it replaced", () => {
    expect(falseLocks(CODEOWNERS_BEFORE)).toEqual([
      "# Push rulesets are refused on public repos, so this uses CODEOWNERS + require_code_owner_review.",
      "# (deploy-production.yml), so a migration waits for a code-owner review",
    ]);
    expect(falseLocks(AGENTS_BEFORE)).toEqual([
      "`/migrations/` is code-owned and needs a code-owner review before merge.",
    ]);
    expect(ownersBlock(CODEOWNERS_BEFORE, "/migrations/ @nish3451")).not.toMatch(NAMES_REAL_GATE);
  });

  it("finds the block it probes, so a rename of either doc goes red", () => {
    expect(ownersBlock(read(CODEOWNERS), "/migrations/ @nish3451")).toContain("/migrations/ @nish3451");
    expect(listItem(read(AGENTS), /^- Migrations \(/)).toContain("a merge to `main` applies them");
  });
});
