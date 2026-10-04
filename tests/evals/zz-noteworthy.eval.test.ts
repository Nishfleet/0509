import { describe, it, vi } from "vitest";

import { D3_KIND, changeState } from "../../app/lib/site/judge.server";
import { jevKeyPresent, loadSiteRows, makeChoiceAsk } from "./harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!jevKeyPresent())("probe: noteworthy scores per case", () => {
  it("prints p for every case, one call each", async () => {
    const rows = await loadSiteRows<boolean>("site-change", "noteworthy_change");
    const kinds = await loadSiteRows<string>("site-change", "change_kind");
    const kindOf = new Map(kinds.map((row) => [row.id, row.label]));
    const ask = makeChoiceAsk(D3_KIND);
    const lines: string[] = [];
    for (const row of rows) {
      const state = changeState(
        {
          isSelf: row.isSelf,
          subject: row.subject,
          pageUrl: row.pageUrl,
          pageRole: row.pageRole,
          hunks: row.hunks,
          evidence: row.evidence,
        },
        row.history_30d,
      );
      try {
        const call = await ask(state);
        lines.push(`${String(row.label)}\t${String(kindOf.get(row.id))}\t${String(call.choice)}\t${row.id}`);
      } catch (error) {
        lines.push(`ERR\t${row.id}\t${error instanceof Error ? error.message.slice(0, 80) : "?"}`);
      }
      await pause(1200);
    }
    console.log(`KIND_PROBE\nlabel\ttrue_kind\tclef_kind\tid\n${lines.join("\n")}`);
  }, 600_000);
});
