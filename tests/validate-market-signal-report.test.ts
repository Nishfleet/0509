import { describe, expect, it } from "vitest";

import { validateReport } from "../scripts/validate-market-signal-report.mjs";

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
UTC boundaries
## Strongest changes
No strong new signal.
## Receipts
Aggregate counts.
## Decision affected
Keep observing.
## Confidence and falsification test
Low; revisit if activation changes.
## Source health
D1 and GitHub ok.
## Unavailable sources
PostHog: unavailable. CRM: unavailable. call-transcript: unavailable. external support-platform: unavailable.
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
});
