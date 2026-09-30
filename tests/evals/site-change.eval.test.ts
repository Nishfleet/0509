import { describe, expect, it, vi } from "vitest";

import { D3S_BREAKAGE, D3_NOTEWORTHY, D3_KIND, changeState } from "../../app/lib/site/judge.server";
import type { ChangeStateInput } from "../../app/lib/site/judge.server";
import { formatReport, jevKeyPresent, loadSiteCases, runSiteChoice, runSiteNoul, type SiteChangeCase } from "./harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));

// The shipped production state builder, fed the same fields a site sweep hands
// judgeChange, so the judged state is the state production judges.
function stateFor(row: SiteChangeCase): unknown {
  const input: ChangeStateInput = {
    isSelf: row.isSelf,
    subject: row.subject,
    pageUrl: row.pageUrl,
    pageRole: row.pageRole,
    hunks: row.hunks,
    evidence: row.evidence,
  };
  return changeState(input, row.history_30d);
}

// The three site questions judge one shared state, so they share one case file.
const CASE_FILE = "site-change";

describe.skipIf(!jevKeyPresent())("eval: site-change judge questions against Jev", () => {
  it("own_site_breakage: scores the shipped D3S_BREAKAGE text on both splits", async () => {
    await loadSiteCases(CASE_FILE);
    const report = await runSiteNoul(CASE_FILE, D3S_BREAKAGE, stateFor);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("noteworthy_change: scores the shipped D3_NOTEWORTHY text on both splits", async () => {
    await loadSiteCases(CASE_FILE);
    const report = await runSiteNoul(CASE_FILE, D3_NOTEWORTHY, stateFor);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("change_kind: scores the shipped D3_KIND options on both splits", async () => {
    await loadSiteCases(CASE_FILE);
    const report = await runSiteChoice(CASE_FILE, D3_KIND, stateFor);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
