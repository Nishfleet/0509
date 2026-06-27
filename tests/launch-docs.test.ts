import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readDoc(path: string) {
  return readFileSync(path, "utf8");
}

describe("final launch documentation", () => {
  it("keeps the authoritative scorecard at PR-ready until live closeout finishes", () => {
    const scorecard = readDoc("docs/final-self-serve-ga-scorecard.md");
    const progress = readDoc("docs/launch-hardening-progress.md");
    const prBody = readDoc("docs/final-self-serve-ga-pr-body.md");

    expect(scorecard).toContain("BRANCH READY FOR PROTECTED PR");
    expect(scorecard).toContain("This is not a live GA verdict");
    expect(scorecard).toContain("PR body draft");
    expect(progress).toContain("PR is still not opened");
    expect(prBody).toContain("post-deploy `0060` migration gate");
    expect(prBody).toContain("Presence website canary remains owner-blocked");

    const authoritativeDocs = `${scorecard}\n${progress}\n${prBody}`;
    expect(authoritativeDocs).not.toContain("RELEASE READY");
    expect(authoritativeDocs).not.toContain("GA LIVE");
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
