import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readDoc(path: string) {
  return readFileSync(path, "utf8");
}

describe("final launch documentation", () => {
  it("keeps the authoritative scorecard on the live monthly/top-up posture after closeout", () => {
    const scorecard = readDoc("docs/final-self-serve-ga-scorecard.md");
    const progress = readDoc("docs/launch-hardening-progress.md");
    const ownerActions = readDoc("docs/ga-owner-actions.md");
    const launchReadiness = readDoc("docs/launch-readiness.md");
    const backupUptime = readDoc("docs/ops-backup-uptime.md");

    expect(scorecard).toContain(
      "SCOUT/STARTER MONTHLY, TOP-UPS, AND AGENCY SELF-SERVE RELEASED - ANNUAL SCOUT/STARTER BLOCKED ON DODO PRICING",
    );
    expect(scorecard).toContain("Dodo annual SKU pricing");
    expect(scorecard).toContain("Latest commercial proof-gate deploy");
    expect(scorecard).toContain("No migrations to apply");
    expect(scorecard).toContain("D1 cleanup evidence");
    expect(progress).toContain("PR #251 merged");
    expect(progress).toContain("Post-cleanup canaries passed again");
    expect(ownerActions).toContain("Completed release actions");
    expect(ownerActions).toContain("Dodo customer portal subscription updates");
    expect(ownerActions).toContain("D1-to-R2 scheduled backup");
    expect(ownerActions).toContain("REPO CONFIGURED / OWNER SECRET");
    expect(scorecard).toContain("Restore drill");
    expect(scorecard).toContain("PASS local");
    expect(scorecard).toContain("WhatsApp stored target review");
    expect(scorecard).toContain("Agency fan-out proof");
    expect(scorecard).toContain("PASS dispatch / WATCH scan health");
    expect(scorecard).toContain("aggregate schema, migration-ledger, plan, Dodo linkage, and retired-provider invariants passed");
    expect(launchReadiness).toContain("not proven active until GitHub repository secrets");
    expect(launchReadiness).toContain("a run completes, and a new R2 object appears");
    expect(backupUptime).toContain("first scheduled Actions run is still unproven");
    expect(backupUptime).toContain("D1_BACKUP_MANUAL_APPROVED=0509-manual-d1-export npm run backup:d1:r2");
    expect(backupUptime).toContain("post-cleanup backup passed an isolated local SQLite import smoke");
    expect(backupUptime).toContain("remote scratch D1 restore attempt");
    expect(backupUptime).toContain('RESTORE_DIR="$(mktemp -d -t 0509-restore.XXXXXX)"');
    expect(backupUptime).toContain("PRAGMA integrity_check");

    const authoritativeDocs = `${scorecard}\n${progress}\n${ownerActions}\n${launchReadiness}\n${backupUptime}`;
    expect(authoritativeDocs).not.toContain("PR is still not opened");
    expect(authoritativeDocs).not.toContain("BRANCH READY FOR PROTECTED PR");
    expect(authoritativeDocs).not.toContain("PENDING POST-DEPLOY");
    expect(authoritativeDocs).not.toMatch(/verified active automated cloud backups/i);
    expect(authoritativeDocs).not.toMatch(/scheduled backup (is )?(complete|verified|active)/i);
    expect(authoritativeDocs).not.toMatch(/automated backup (is )?(complete|verified|active)/i);
    expect(authoritativeDocs).not.toMatch(/Backup integrity proven/i);
    expect(authoritativeDocs).not.toContain("Agency remains held until live fan-out proof passes");
    expect(authoritativeDocs).not.toContain("keep Agency held until fan-out proof passes");
    expect(authoritativeDocs).not.toContain("Agency fan-out proof, and Cloudflare Email dashboard visibility");
    expect(authoritativeDocs).not.toMatch(/0509-\d{4}-\d{2}-\d{2}T/i);
    expect(authoritativeDocs).not.toMatch(/\b1 user\b/i);
    expect(authoritativeDocs).not.toMatch(/\b3 not-validated/i);
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
