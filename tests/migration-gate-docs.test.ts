import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CODEOWNERS = new URL("../.github/CODEOWNERS", import.meta.url);
const AGENTS = new URL("../AGENTS.md", import.meta.url);
const CLAUDE = new URL("../CLAUDE.md", import.meta.url);

const read = (url: URL): string => readFileSync(url, "utf8");

const CLAIMS_A_LOCK =
  /code[-_ ]owner review|require_code_owner_review|owner review required|code ownership gate|CODEOWNERS enforces/i;

const DENY_PHRASES = [
  /require_code_owner_review:false/,
  /not a code-owner review/i,
  /No code-owner review stands/i,
  /GitHub never lets an author approve/i,
  /is not the gate/i,
  /does not enforce/i,
  /not enforced/i,
  /neither required/i,
] as const;

function falseLocks(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && CLAIMS_A_LOCK.test(line) && !DENY_PHRASES.some((deny) => deny.test(line)));
}

const NAMES_REAL_GATE = /needs-coordinator/;
const NAMES_RULESET_PARAM = /require_code_owner_review:false/;

const OLD_CLAIMS = [
  "this uses CODEOWNERS + require_code_owner_review",
  "a migration waits for a code-owner review",
  "needs a code-owner review before merge",
] as const;

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

function ownersBlock(text: string, pattern: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim() === pattern);
  if (at === -1) return "";
  let start = at;
  while (start > 0 && lines[start - 1].trim().startsWith("#")) start -= 1;
  return lines.slice(start, at + 1).join("\n");
}

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

  it("claims no gate in CLAUDE.md that ruleset 21391031 does not enforce", () => {
    expect(falseLocks(read(CLAUDE))).toEqual([]);
  });

  it("names needs-coordinator as the migration's gate, in both entry docs", () => {
    expect(ownersBlock(read(CODEOWNERS), "/migrations/ @nish3451")).toMatch(NAMES_REAL_GATE);
    expect(listItem(read(AGENTS), /^- Migrations \(/)).toMatch(NAMES_REAL_GATE);
  });

  it("names the live ruleset param in both entry docs", () => {
    expect(read(CODEOWNERS)).toMatch(NAMES_RULESET_PARAM);
    expect(listItem(read(AGENTS), /^- Migrations \(/)).toMatch(NAMES_RULESET_PARAM);
  });

  it("drops the three origin/main lock sentences", () => {
    const live = `${read(CODEOWNERS)}\n${read(AGENTS)}\n${read(CLAUDE)}`;
    expect(OLD_CLAIMS.filter((claim) => live.includes(claim))).toEqual([]);
  });

  it("fails the same text it replaced", () => {
    expect(falseLocks(CODEOWNERS_BEFORE)).toEqual([
      "# Push rulesets are refused on public repos, so this uses CODEOWNERS + require_code_owner_review.",
      "# (deploy-production.yml), so a migration waits for a code-owner review",
    ]);
    expect(falseLocks(AGENTS_BEFORE)).toEqual([
      "`/migrations/` is code-owned and needs a code-owner review before merge.",
    ]);
    expect(ownersBlock(CODEOWNERS_BEFORE, "/migrations/ @nish3451")).not.toMatch(NAMES_REAL_GATE);
    expect(OLD_CLAIMS.filter((claim) => `${CODEOWNERS_BEFORE}\n${AGENTS_BEFORE}`.includes(claim))).toEqual([
      ...OLD_CLAIMS,
    ]);
  });

  it("finds the block it probes, so a rename of either doc goes red", () => {
    expect(ownersBlock(read(CODEOWNERS), "/migrations/ @nish3451")).toContain("/migrations/ @nish3451");
    expect(listItem(read(AGENTS), /^- Migrations \(/)).toContain("a merge to `main` applies them");
  });
});
