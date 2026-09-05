import { describe, expect, it } from "vitest";

import { isValidReportDate, validateReport } from "../scripts/validate-market-signal-report.mjs";

const validReport = `---
authored_by: hermes-vps
writer_surface: hermes
writer_model: live
tier: raw
status: captured
derived_from: []
sources: []
last_verified: 2026-08-02
verification_status: verified
council_status: not_required
human_locked: false
---
# What the market is telling 0509
2026-08-02
## Evidence window
UTC: 2026-08-01T00:00:00Z to 2026-08-02T00:00:00Z; previous 2026-07-31T00:00:00Z to 2026-08-01T00:00:00Z.
## Strongest changes
No strong new signal.
## Receipts
15 aggregate users observed.
## Decision affected
Keep observing.
## Confidence and falsification test
Low; revisit if activation changes.
## Source health
D1 and GitHub ok.
## Unavailable sources
PostHog: unavailable; not checked. CRM: unavailable; not checked. call-transcript: unavailable; not checked. external support-platform: unavailable; not checked.
`;

describe("market signal report validation", () => {
  it("accepts the complete private report contract", () => {
    expect(validateReport(validReport, "2026-08-02")).toEqual([]);
  });

  it("rejects missing sections and sensitive customer identifiers", () => {
    const issues = validateReport(validReport.replace("## Receipts", "Customer customer@example.com"), "2026-08-02");
    expect(issues).toContain("missing_section:## Receipts");
    expect(issues).toContain("sensitive_content_detected");
  });

  it("does not accept frontmatter fields or source statuses from the report body", () => {
    const bodyFrontmatter = validReport
      .replace("authored_by: hermes-vps", "authored_by: somebody-else")
      .concat("\nauthored_by: hermes-vps\n");
    expect(validateReport(bodyFrontmatter, "2026-08-02")).toContain("invalid_frontmatter_field:authored_by");

    const misplacedStatuses = validReport
      .replace(
        "PostHog: unavailable; not checked. CRM: unavailable; not checked. call-transcript: unavailable; not checked. external support-platform: unavailable; not checked.",
        "PostHog, CRM, call-transcript, external support-platform.",
      )
      .concat("\nAll statuses elsewhere: unavailable and failed.\n");
    expect(validateReport(misplacedStatuses, "2026-08-02")).toContain("missing_unavailable_source_status:PostHog");
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidReportDate("2026-08-02")).toBe(true);
    expect(isValidReportDate("2026-02-30")).toBe(false);
    expect(isValidReportDate("2026-13-01")).toBe(false);
  });
});
