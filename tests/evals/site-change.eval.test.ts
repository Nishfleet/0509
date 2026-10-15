import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { D3S_BREAKAGE, D3_NOTEWORTHY, D3_KIND, changeState } from "../../app/lib/site/judge.server";
import type { ChangeStateInput } from "../../app/lib/site/judge.server";
import { formatCuts, kindCuts, type CutSample } from "./cuts";
import {
  choiceScore,
  formatReport,
  jevKeyPresent,
  loadProdRows,
  loadSiteRows,
  mapLimit,
  makeChoiceAsk,
  makeNoulAsk,
  noulScore,
  runEval,
  type SiteRow,
} from "./harness";

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

const PROD_FILE = new URL("./cases/site-change-prod.json", import.meta.url);

describe.skipIf(!jevKeyPresent() || !existsSync(PROD_FILE))("eval: labelled production changes, per-kind cuts", () => {
  it("prints the best noteworthy cut for each predicted kind", async () => {
    const rows = await loadProdRows();
    const noteworthy = makeNoulAsk(D3_NOTEWORTHY);
    const kind = makeChoiceAsk(D3_KIND);
    const samples = await mapLimit(rows, 4, async (row): Promise<CutSample> => {
      const state = stateFor(row);
      const [asked, kinded] = await Promise.all([noteworthy(state), kind(state)]);
      return { kind: kinded.choice ?? "noise", label: row.label, p: asked.p ?? 0 };
    });
    console.log(formatCuts(kindCuts(samples)));
    expect(samples).toHaveLength(rows.length);
  });
});
