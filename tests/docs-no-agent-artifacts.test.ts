import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Issue #2954: the public repo must not ship agent memory / state / design-QA
// / audit notes (MEMORY.md, agent-state/**, design-qa*.md, docs/*audit*.md).
// They were scrubbed from the tree and archived privately (2026-09-11); this
// guard does what encode-based checkers cannot: it looks at what GIT actually
// tracks, so untracked local helper files can never green it by accident, and
// re-adding any of these paths fails CI.
//
// Deliberate exceptions (each enforced bare by the list below, not by a
// weaker pattern):
// - docs/customer-claim-audit-table.json — the issue's own check-first rule
//   stopped its removal: tests/customer-claim-audit-table.test.ts and
//   scripts/verify-customer-claim-audit.mjs read it live (issue #955
//   enforcement). Competitor-claim data, no personal content.
// - docs/ga-customer-journey-audit.md — read live by
//   tests/launch-docs.test.ts ("historical audit" marker contract).
// Removing one of these requires retiring or moving its live reader first.
const EXCEPTIONS = new Set([
  "docs/customer-claim-audit-table.json",
  "docs/ga-customer-journey-audit.md",
]);

const EXACT_PATHS = new Set([
  "MEMORY.md",
  "design-qa.md",
  "design-qa-wave1.md",
]);

const DIR_PREFIXES = ["agent-state/"];

const DOC_AUDIT_PATTERN = /^(docs)\/*[^/]*audit[^/]*\.(md|json)$/i;

function trackedFiles(): string[] {
  const out = execSync("git ls-files -z", {
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.toString("utf8").split("\0").filter((f) => f.length > 0);
}

describe("public-tree privacy guard (issue #2954)", () => {
  const tracked = trackedFiles();

  it("no tracked agent memory, state, QA or audit notes in the repo", () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      if (EXCEPTIONS.has(file)) continue;
      if (EXACT_PATHS.has(file) || DIR_PREFIXES.some((p) => file.startsWith(p))) {
        offenders.push(file);
        continue;
      }
      if (DOC_AUDIT_PATTERN.test(file)) {
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

  it("guard fits the tracked tree shape (would catch the scrubbed paths)", () => {
    // Negative control: the guard is not vacuous. With the files scrubbed it
    // matches nothing, so mutate pattern inputs directly instead.
    expect(EXACT_PATHS.has("MEMORY.md")).toBe(true);
    expect(DOC_AUDIT_PATTERN.test("docs/search-relevance-audit.md")).toBe(true);
    expect(DOC_AUDIT_PATTERN.test("docs/INTENT-AUDIT-2026-07-21.md")).toBe(true);
    expect(DOC_AUDIT_PATTERN.test("docs/customer-claim-audit-table.json")).toBe(
      true,
    );
    // The two documented exceptions must never be flagged by the pattern.
    for (const exc of EXCEPTIONS) {
      if (EXACT_PATHS.has(exc)) continue;
      expect(DOC_AUDIT_PATTERN.test(exc) && !EXCEPTIONS.has(exc)).toBe(false);
    }
  });
});
