import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readDoc(path: string) {
  return readFileSync(path, "utf8");
}

describe("final launch documentation", () => {
  it("keeps dated release evidence subordinate to the canonical current 0/6 verdict", () => {
    const scorecard = readDoc("docs/final-self-serve-ga-scorecard.md");
    const progress = readDoc("docs/launch-hardening-progress.md");
    const ownerActions = readDoc("docs/ga-owner-actions.md");
    const launchReadiness = readDoc("docs/launch-readiness.md");
    const backupUptime = readDoc("docs/ops-backup-uptime.md");
    const planCatalog = readDoc("docs/plan-catalog.md");
    const uptimeWorkflow = readDoc(".github/workflows/uptime-health.yml");

    expect(scorecard).toContain("Historical release verdict");
    expect(scorecard).toContain("Current Gate A–C release readiness is **0/6**");
    expect(scorecard).toContain("current A–C open");
    expect(scorecard).toContain("Dodo's documented by-currency localized pricing mode");
    expect(scorecard).toContain("redacted Dodo API product proof confirmed");
    expect(scorecard).toContain("Dodo Product Collection membership is configured");
    expect(scorecard).toContain("owner-only in-app plan switching");
    expect(planCatalog).toContain("Historical production status");
    expect(planCatalog).toContain("not current-candidate evidence");
    expect(planCatalog).toContain("prices load from Dodo at runtime");
    expect(planCatalog).toContain("Every 6 hours");
    expect(planCatalog).toContain("Every 3 hours");
    expect(planCatalog).toContain("Top 25 every 3 hours, rest every 6 hours");
    expect(ownerActions).toContain("owner-only in-app switching");
    expect(ownerActions).toContain("Dodo's documented plan-change preview/change endpoints");
    expect(launchReadiness).toContain("Five to Nine Product Collection");
    expect(scorecard).toContain("Latest commercial proof-gate deploy");
    expect(scorecard).toContain("0062_dodo_plan_change_pending_target.sql");
    expect(scorecard).toContain("D1 cleanup evidence");
    expect(progress).toContain("PR #251 merged");
    expect(progress).toContain("Post-cleanup canaries passed again");
    expect(ownerActions).toContain("Completed release actions");
    expect(ownerActions).toContain("Dodo in-app plan switching and portal cancellation");
    expect(ownerActions).toContain("Uptime health workflow");
    expect(launchReadiness).toContain("Scheduled runs `28548096175`, `28552452662`, and `28555610571` passed");
    expect(scorecard).toContain("manual run `28540913266` and scheduled runs");
    expect(ownerActions).toContain("SCHEDULED PASS / ALERT UNPROVEN");
    expect(backupUptime).toContain(".github/workflows/uptime-health.yml");
    expect(uptimeWorkflow).toContain("https://0509.io/api/health");
    // Production liveness detection moved off GitHub Actions onto the VPS
    // systemd timer at ops/liveness/ (the GitHub 5-minute cron never
    // delivered — median 63 min between scheduled runs over 300 observations,
    // 2026-07-25..2026-08-11). The workflow is now on-demand only; it still
    // runs the same probe pair when invoked.
    expect(uptimeWorkflow).not.toContain(
      'cron: "2,7,12,17,22,27,32,37,42,47,52,57 * * * *"',
    );
    expect(uptimeWorkflow).toContain("0509-liveness");
    expect(uptimeWorkflow).toContain("on-demand");
    expect(ownerActions).toContain("D1-to-R2 scheduled backup");
    expect(ownerActions).toContain("PROVEN DISPATCH 2026-07-13 / FUTURE OBSERVATION OPEN");
    expect(scorecard).toContain("Restore drill");
    expect(scorecard).toContain("PASS LOCAL / REMOTE SCRATCH OPEN");
    expect(scorecard).toContain("WhatsApp stored target review");
    expect(scorecard).toContain("Agency fan-out proof");
    expect(scorecard).toContain("DATED PASS DISPATCH / EXTERNAL SCAN WATCH");
    expect(scorecard).toContain("aggregate schema, migration-ledger, plan, Dodo linkage, and retired-provider invariants passed");
    expect(launchReadiness).toContain("A fresh owner-operated manual backup uploaded to R2 on 2026-07-02");
    expect(launchReadiness).toContain("required Cloudflare repository secrets were absent on 2026-07-02");
    expect(launchReadiness).toContain("first successful Actions backup end-to-end");
    expect(backupUptime).toContain("Unblocked 2026-07-13");
    expect(backupUptime).toContain("D1_BACKUP_MANUAL_APPROVED=0509-manual-d1-export npm run backup:d1:r2");
    expect(backupUptime).toContain("2026-07-02 owner-operated manual backup");
    expect(backupUptime).toContain("2026-07-13 operator-run manual backup");
    expect(backupUptime).toContain("post-cleanup backup passed an isolated local SQLite import smoke");
    expect(ownerActions).toContain("INTERNAL SUBSCRIPTION NEEDED");
    expect(launchReadiness).toContain("no linked Scout/Starter subscriptions");
    expect(scorecard).toContain("no linked Scout/Starter subscriptions");
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
    expect(authoritativeDocs).not.toMatch(/alert[- ]routing proof (is )?(complete|verified|proven)/i);
    expect(authoritativeDocs).not.toMatch(/failure[- ]notification (path|proof) (is )?(complete|verified|proven)/i);
    expect(authoritativeDocs).not.toContain(`OPENCODE_GO_${"API_KEY"}`);
    expect(authoritativeDocs).not.toContain("Agency remains held until live fan-out proof passes");
    expect(authoritativeDocs).not.toContain("keep Agency held until fan-out proof passes");
    expect(authoritativeDocs).not.toContain("Agency fan-out proof, and Cloudflare Email dashboard visibility");
    expect(authoritativeDocs).not.toContain("ANNUAL SCOUT/STARTER BLOCKED ON DODO PRICING");
    expect(authoritativeDocs).not.toContain("annual Scout/Starter checkout remains intentionally fail-closed");
    expect(authoritativeDocs).not.toContain("DODO ANNUAL SKU CONFIG REQUIRED");
    expect(authoritativeDocs).not.toMatch(/0509-\d{4}-\d{2}-\d{2}T/i);
    expect(authoritativeDocs).not.toMatch(/\b1 user\b/i);
    expect(authoritativeDocs).not.toMatch(/\b3 not-validated/i);
    expect(planCatalog).not.toContain("prices unconfigured");
    expect(planCatalog).not.toContain("Checkout SKUs and amounts are unconfigured");
    expect(planCatalog).not.toContain("Dodo product IDs for v1 plan and top-up SKUs remain owner-configured");
    expect(planCatalog).not.toContain("Monday scheduled");
    expect(planCatalog).not.toContain("Daily scheduled");
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
