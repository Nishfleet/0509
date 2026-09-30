import { describe, expect, it, vi } from "vitest";

import { D3S_BREAKAGE, D3_NOTEWORTHY, D3_KIND, changeState } from "../../app/lib/site/judge.server";
import type { ChangeStateInput } from "../../app/lib/site/judge.server";
import {
  choiceScore,
  formatReport,
  jevKeyPresent,
  loadSiteRows,
  makeChoiceAsk,
  makeNoulAsk,
  noulScore,
  runEval,
  type SiteRow,
} from "./harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));

// The shipped production state builder, fed the same fields a site sweep hands
// judgeChange, so the judged state is the state production judges.
function stateFor(row: SiteRow<boolean | string>): unknown {
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

const CASE_FILE = "site-change";

describe.skipIf(!jevKeyPresent())("eval: site-change judge questions against Jev", () => {
  it("own_site_breakage: scores the shipped D3S_BREAKAGE text on both splits", async () => {
    const rows = await loadSiteRows<boolean>(CASE_FILE, D3S_BREAKAGE.id);
    const ask = makeNoulAsk(D3S_BREAKAGE);
    const report = await runEval(D3S_BREAKAGE.id, rows, (row) => ask(stateFor(row)), noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("noteworthy_change: scores the shipped D3_NOTEWORTHY text on both splits", async () => {
    const rows = await loadSiteRows<boolean>(CASE_FILE, D3_NOTEWORTHY.id);
    const ask = makeNoulAsk(D3_NOTEWORTHY);
    const report = await runEval(D3_NOTEWORTHY.id, rows, (row) => ask(stateFor(row)), noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("change_kind: scores the shipped D3_KIND options on both splits", async () => {
    const rows = await loadSiteRows<string>(CASE_FILE, D3_KIND.id);
    const ask = makeChoiceAsk(D3_KIND);
    const report = await runEval(D3_KIND.id, rows, (row) => ask(stateFor(row)), choiceScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
