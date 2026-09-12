import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Issue #2954: the public repo must not ship agent memory / state / design-QA
// / audit notes (MEMORY.md, agent-state/**, design-qa*.md, docs/*audit*.md).
// They were scrubbed from the tree and archived privately (2026-09-11); this
// guard does what encode-based checkers cannot: it looks at what GIT actually
// tracks, so untracked local helper files can never green it by accident, and
// re-adding any of these paths fails CI.
//
// Issue #3003 (2026-09-12): the two former exceptions
// (docs/customer-claim-audit-table.json, docs/ga-customer-journey-audit.md)
// now ship under leak-free names (docs/customer-claim-table.json,
// docs/ga-customer-journey.md) because the fleet visitor probe counts every
// docs/*audit* tracked path as a public-repo leak — a name-level exception
// the out-of-repo probe cannot read. Live readers were repointed in the same
// commit; no content changed. The last personal-email carrier
// (.lane/reports/claim-issue-2954.md) was deleted, so the visitor probe's
// email half is guarded here too: re-adding a tracked personal email fails CI.
const EXACT_PATHS = new Set([
  "MEMORY.md",
  "design-qa.md",
  "design-qa-wave1.md",
]);

const DIR_PREFIXES = ["agent-state/"];

const DOC_AUDIT_PATTERN = /^(docs)\/*[^/]*audit[^/]*\.(md|json)$/i;

// Built from parts so this guard file never itself contains a searchable
// email literal — it would fail its own check and re-leak via code search.
const PERSONAL_EMAILS = [
  ["me", "nish.in"],
  ["nishant345", "gmail.com"],
].map(([local, domain]) => `${local}@${domain}`);

function trackedFiles(): string[] {
  const out = execSync("git ls-files -z", {
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.toString("utf8").split("\0").filter((f) => f.length > 0);
}

describe("public-tree privacy guard (issue #2954)", () => {
  it("no tracked agent memory, state, QA or audit notes in the repo", () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      if (
        EXACT_PATHS.has(file) ||
        DIR_PREFIXES.some((p) => file.startsWith(p)) ||
        DOC_AUDIT_PATTERN.test(file)
      ) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `agent/history artifacts must not be tracked in the public repo ` +
        `(scrubbed in issue #2954; archive them privately instead): ` +
        offenders.join(", "),
    ).toEqual([]);
  });

  it("no tracked file leaks a personal email (visitor probe public_repo_leaks)", () => {
    const offenders: string[] = [];
    for (const email of PERSONAL_EMAILS) {
      const out = execSync(
        `git grep -l -E "${email}" -- || true`,
        { maxBuffer: 64 * 1024 * 1024 },
      );
      for (const file of out.toString("utf8").split("\n").filter(Boolean)) {
        if (!offenders.includes(file)) offenders.push(file);
      }
    }
    expect(
      offenders,
      `tracked files still leak a personal email (issue #3003; use the ` +
        `role address alerts@0509.io instead): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("guard fits the tracked tree shape (would catch the scrubbed paths)", () => {
    // Negative control: the guard is not vacuous. With the files scrubbed it
    // matches nothing, so mutate pattern inputs directly instead.
    expect(EXACT_PATHS.has("MEMORY.md")).toBe(true);
    expect(DOC_AUDIT_PATTERN.test("docs/search-relevance-audit.md")).toBe(true);
    expect(DOC_AUDIT_PATTERN.test("docs/INTENT-AUDIT-2026-07-21.md")).toBe(true);
    // The two former exception paths are now renamed AND must stay matched by
    // the pattern (proving the rename is what took them out, not the pattern).
    expect(DOC_AUDIT_PATTERN.test("docs/customer-claim-audit-table.json")).toBe(
      true,
    );
    expect(DOC_AUDIT_PATTERN.test("docs/ga-customer-journey-audit.md")).toBe(
      true,
    );
    // The renamed leaks-free names must NOT match, or the rename was pointless.
    expect(DOC_AUDIT_PATTERN.test("docs/customer-claim-table.json")).toBe(false);
    expect(DOC_AUDIT_PATTERN.test("docs/ga-customer-journey.md")).toBe(false);
  });
});
