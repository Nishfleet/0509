import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { D3_KIND, D3_NOTEWORTHY } from "../../app/lib/site/judge.server";
import { formatCuts, kindCuts, type CutSample } from "./cuts";
import { jevKeyPresent, loadProdRows, makeChoiceAsk, makeNoulAsk, mapLimit } from "./harness";
import { stateFor } from "./site-change-state";

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
