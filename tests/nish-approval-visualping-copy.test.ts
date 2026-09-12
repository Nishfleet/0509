import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SWITCH_PAGES } from "~/lib/switch-pages";

// Issue #3020: the Visualping switch page copy is gated on Nish's sign-off
// ([NISH]) before publish-time changes. docs/nish-approvals/visualping-switch-copy.md
// is the frozen approval baseline. This test fails when the shipped copy in
// SWITCH_PAGES.visualping drifts from that file — any copy edit must land a
// matching approval-doc edit in the same change, so Nish's sign-off is forced
// rather than hoped for. It is the /switch/** sibling of the #2998
// citation-staleness gating (as-of dates beside competitor claims).

const ROOT = join(__dirname, "..");
const DOC_PATH = join(ROOT, "docs", "nish-approvals", "visualping-switch-copy.md");

describe("nish approval: /switch/visualping copy is pinned to the approval record", () => {
  const page = SWITCH_PAGES.visualping;
  const doc = readFileSync(DOC_PATH, "utf8");

  const pinnedCopy: Array<[string, string]> = [
    ["kicker", page.kicker],
    ["headline", page.headline],
    ["deck", page.deck],
    ["card line", page.cardLine],
    ["SEO title", page.title],
    ["complaint quote", page.complaint.quote],
  ];

  for (const [label, copy] of pinnedCopy) {
    it(`${label} appears verbatim in the approval record`, () => {
      expect(doc, `${label} must stay pinned in docs/nish-approvals`).toContain(copy);
    });
  }

  for (const source of [page.complaint.source, ...page.furtherSources]) {
    it(`source ${source.href} carries its checked date and is listed in the record`, () => {
      expect(doc).toContain(source.href);
      // The as-of date from the citations-staleness pattern must be beside the
      // claim in the record, not silently dropped.
      expect(doc).toContain(source.checked);
    });
  }

  it("the sign-off checklist stays pending until Nish marks it", () => {
    // Unchecked boxes are the pending state; a ticked box must carry the
    // literal [NISH] marker so the approval is human-attributed, not agent-
    // fabricated.
    const lines = doc.split("\n").filter((line) => line.trim().startsWith("- ["));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      if (line.includes("[x]")) {
        expect(line.includes("[NISH]"), `sign-off line without [NISH]: ${line.trim()}`).toBe(true);
      }
    }
  });

  it("every page claim carries a first-party source with a checked date", () => {
    expect(page.complaint.source.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(page.furtherSources.length).toBeGreaterThan(0);
    for (const source of page.furtherSources) {
      expect(source.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
