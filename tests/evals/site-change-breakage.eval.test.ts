import { describe, it, expect } from "vitest";

import { D3S_BREAKAGE } from "../../app/lib/site/judge.server";
import { formatReport, jevKeyPresent, loadSiteRows, makeNoulAsk, noulScore, runEval } from "./harness";
import { CASE_FILE, stateFor } from "./site-change-state";

describe.skipIf(!jevKeyPresent())("eval: site-change own-site breakage against Jev", () => {
  it("own_site_breakage: scores the shipped D3S_BREAKAGE text on both splits", async () => {
    const rows = await loadSiteRows<boolean>(CASE_FILE, D3S_BREAKAGE.id);
    const ask = makeNoulAsk(D3S_BREAKAGE);
    const report = await runEval(D3S_BREAKAGE.id, rows, (row) => ask(stateFor(row)), noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
