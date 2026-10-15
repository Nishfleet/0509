import { describe, it, expect } from "vitest";

import { D3_KIND } from "../../app/lib/site/judge.server";
import { choiceScore, formatReport, jevKeyPresent, loadSiteRows, makeChoiceAsk, runEval } from "./harness";
import { CASE_FILE, half, misses, stateFor } from "./site-change-state";

describe.skipIf(!jevKeyPresent())("eval: site-change kind question against Jev, half b", () => {
  it("change_kind: scores the shipped D3_KIND options on the chosen split, half b", async () => {
    const rows = half(await loadSiteRows<string>(CASE_FILE, D3_KIND.id), 1);
    const ask = makeChoiceAsk(D3_KIND);
    const picks = new Map<string, string[]>();
    const report = await runEval(
      D3_KIND.id,
      rows,
      async (row) => {
        const answer = await ask(stateFor(row));
        picks.set(row.id, [...(picks.get(row.id) ?? []), answer.choice ?? ""]);
        return answer;
      },
      choiceScore,
    );
    console.log(formatReport(report));
    console.log(misses(rows, picks));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
