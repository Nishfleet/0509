import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readDoc(path: string) {
  return readFileSync(path, "utf8");
}

describe("final launch documentation", () => {
  it("keeps the authoritative scorecard on the released posture after live closeout", () => {
    const scorecard = readDoc("docs/final-self-serve-ga-scorecard.md");
    const progress = readDoc("docs/launch-hardening-progress.md");
    const ownerActions = readDoc("docs/ga-owner-actions.md");

    expect(scorecard).toContain("SCOUT AND STARTER SELF-SERVE RELEASED");
    expect(scorecard).toContain("OWNER ACTIONS REMAIN");
    expect(scorecard).toContain("Compatible Worker deployed");
    expect(scorecard).toContain("No migrations to apply");
    expect(scorecard).toContain("D1 cleanup evidence");
    expect(progress).toContain("PR #251 merged");
    expect(progress).toContain("Post-cleanup canaries passed again");
    expect(ownerActions).toContain("Completed release actions");
    expect(ownerActions).toContain("Dodo customer portal subscription updates");

    const authoritativeDocs = `${scorecard}\n${progress}\n${ownerActions}`;
    expect(authoritativeDocs).not.toContain("PR is still not opened");
    expect(authoritativeDocs).not.toContain("BRANCH READY FOR PROTECTED PR");
    expect(authoritativeDocs).not.toContain("PENDING POST-DEPLOY");
  });

  it("marks older launch scorecards as historical instead of current truth", () => {
    const historicalScorecard = readDoc("docs/ga-launch-scorecard.md");
    const journeyAudit = readDoc("docs/ga-customer-journey-audit.md");

    expect(historicalScorecard).toContain("Historical scorecard");
    expect(historicalScorecard).toContain("SUPERSEDED");
    expect(historicalScorecard).toContain("do not use this file as the live GA verdict");
    expect(journeyAudit).toContain("Historical audit");
    expect(journeyAudit).toContain("use that file for current PR/deploy status");
    expect(journeyAudit).toContain("served homepage no longer shows this announcement");

    expect(`${historicalScorecard}\n${journeyAudit}`).not.toContain(
      "GA LIVE — SCOUT AND STARTER FOR SALE, AGENCY HELD",
    );
    expect(journeyAudit).not.toContain("Beta announcement on homepage deferred to Phase 10");
    expect(journeyAudit).not.toContain("pilot framing");
  });
});
