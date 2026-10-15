import { describe, it, expect } from "vitest";

import { D3_NOTEWORTHY } from "../../app/lib/site/judge.server";
import { formatReport, jevKeyPresent, loadSiteRows, makeNoulAsk, noulScore, runEval } from "./harness";
import { CASE_FILE, half, stateFor } from "./site-change-state";

describe.skipIf(!jevKeyPresent())("eval: site-change noteworthy question against Jev, half b", () => {
  it("noteworthy_change: scores the shipped D3_NOTEWORTHY text on the chosen split, half b", async () => {
    const rows = half(await loadSiteRows<boolean>(CASE_FILE, D3_NOTEWORTHY.id), 1);
    const ask = makeNoulAsk(D3_NOTEWORTHY);
    const report = await runEval(D3_NOTEWORTHY.id, rows, (row) => ask(stateFor(row)), noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
