import { describe, expect, it, vi } from "vitest";

import { D3_KIND, D3_NOTEWORTHY, changeState } from "../../app/lib/site/judge.server";
import type { ChangeStateInput } from "../../app/lib/site/judge.server";
import {
  formatReport,
  jevKeyPresent,
  loadSiteRows,
  makeChoiceAsk,
  makeNoulAsk,
  runEval,
  type SiteRow,
} from "./harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const SPACING_MS = 2000;
let gate: Promise<unknown> = Promise.resolve();

function paced<T>(call: () => Promise<T>): Promise<T> {
  const turn = gate.then(() => call());
  const wait = () => new Promise((resolve) => setTimeout(resolve, SPACING_MS));
  gate = turn.then(wait, wait);
  return turn;
}

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

const KINDS = new Set(["noise", "copy", "offer"]);

async function rowsOf() {
  const nw = await loadSiteRows<boolean>("site-change", "noteworthy_change");
  const kinds = await loadSiteRows<string>("site-change", "change_kind");
  const kindOf = new Map(kinds.map((row) => [row.id, row.label]));
  return nw
    .filter((row) => KINDS.has(kindOf.get(row.id) ?? ""))
    .map((row) => ({ row, kind: kindOf.get(row.id) ?? "" }));
}

describe.skipIf(!jevKeyPresent())("probe: pricing noteworthy and kind per case", () => {
  it("noteworthy p", async () => {
    const picked = await rowsOf();
    const kindById = new Map(picked.map((entry) => [entry.row.id, entry.kind]));
    const ask = makeNoulAsk(D3_NOTEWORTHY);
    const report = await runEval(
      "pricing_noteworthy",
      picked.map((entry) => entry.row),
      (row) =>
        paced(async () => {
          const call = await ask(stateFor(row));
          console.log(
            `PR\tnw\t${row.split}\t${row.id}\t${String(row.label)}\t${kindById.get(row.id) ?? ""}\t${(call.p ?? 0).toFixed(3)}`,
          );
          return call;
        }),
      (row, call) => ({ points: (call.p ?? 0) >= 0.5 === row.label ? 1 : 0, uncertain: false, key: "x" }),
    );
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("clef kind", async () => {
    const picked = await rowsOf();
    const kindById = new Map(picked.map((entry) => [entry.row.id, entry.kind]));
    const ask = makeChoiceAsk(D3_KIND);
    const report = await runEval(
      "pricing_kind",
      picked.map((entry) => entry.row),
      (row) =>
        paced(async () => {
          const call = await ask(stateFor(row));
          console.log(
            `PR\tkind\t${row.split}\t${row.id}\t${String(row.label)}\t${kindById.get(row.id) ?? ""}\t${String(call.choice)}`,
          );
          return call;
        }),
      (row, call) => ({
        points: call.choice === kindById.get(row.id) ? 1 : 0,
        uncertain: false,
        key: String(call.choice),
      }),
    );
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
