import { describe, expect, it } from "vitest";

import { noulAction } from "../../app/lib/jev/thresholds";
import { sha256Hex } from "../../app/lib/sha256";
import { computeBreakageEvidence } from "../../app/lib/site/breakage-evidence";
import { diffPageText } from "../../app/lib/site/diff";
import { changeState, D3S_BREAKAGE } from "../../app/lib/site/judge.server";
import { FIXTURE_HEALTHY_TEXT, FIXTURE_SOFT_TEXT } from "../fixtures/fixture-page-texts";
import { formatReport, jevKeyPresent, makeNoulAsk, noulScore, runEval, type NoulEvalRow } from "./harness";

// 0509#7340's measurement: the shipped D3S_BREAKAGE question, fed the exact
// judged state the nightly sweep produces for the J8 soft fixture, must answer
// alert (p >= 0.5), and the healthy page must stay clear. The old soft break (a
// 200 with only the pricing section gone) swung 0.58 -> 0.173 across nights
// because the judge read a tidy one-section removal as a deliberate redesign;
// the fixture now keeps nothing visible but its title. The two texts are
// extractPageText's output for the fixture's healthy and soft pages, shared
// with tests/integration/fixture-site.test.ts from
// tests/fixtures/fixture-page-texts.ts — that test fails if the fixture's
// visible text ever changes, and the eval's input is regenerated with it. The
// eval runtime is node: it has no HTMLRewriter to re-run the extraction, and
// the fixture module itself extends DurableObject, so neither step can be
// re-derived here — which is why the walk is pinned in the workers project
// instead.
const SUBJECT = { name: "Five to Nine", domain: "0509.in" };
const PAGE_URL = "https://j8-soft.fixture.0509.in/";

// The same builders the sweep hands judgeChange, on the texts the integration
// test proves production extracts: sha256Hex is extractPageText's own hash, so
// the ExtractedPageText pair and the hunks and evidence out of diffPageText and
// computeBreakageEvidence are what production would judge.
async function extracted(text: string) {
  return { text, hash: await sha256Hex(text), charCount: text.length };
}

async function fixtureStates(): Promise<Record<string, unknown>> {
  const before = await extracted(FIXTURE_HEALTHY_TEXT);
  const after = await extracted(FIXTURE_SOFT_TEXT);
  const diff = diffPageText(before, after);
  if (diff === null) throw new Error("the soft break must change the page text");
  const base = {
    isSelf: true,
    subject: SUBJECT,
    pageUrl: PAGE_URL,
    pageRole: "home",
    history30d: [] as never[],
  };
  return {
    "fixture-soft-broken": changeState(
      {
        ...base,
        hunks: diff.hunks,
        evidence: computeBreakageEvidence({
          status: 200,
          beforeText: FIXTURE_HEALTHY_TEXT,
          afterText: FIXTURE_SOFT_TEXT,
        }),
      },
      base.history30d,
    ),
    "fixture-healthy": changeState(
      {
        ...base,
        // An unchanged page never reaches the judge in production (the sweep
        // short-circuits on the hash); the control asks the question what it
        // would say if it saw the healthy page with no diff at all.
        hunks: [],
        evidence: computeBreakageEvidence({
          status: 200,
          beforeText: FIXTURE_HEALTHY_TEXT,
          afterText: FIXTURE_HEALTHY_TEXT,
        }),
      },
      base.history30d,
    ),
  };
}

const rows: NoulEvalRow[] = [
  {
    id: "fixture-soft-broken",
    split: "train",
    label: true,
    why: "a 200 that lost every visible section overnight: title survives, body renders nothing, prices gone with the rest",
  },
  {
    id: "fixture-healthy",
    split: "train",
    label: false,
    why: "the healthy fixture page: hero line, priced plans, checkout link all present",
  },
];

describe.skipIf(!jevKeyPresent())("eval: the J8 soft fixture's judged state against Jev (0509#7340)", () => {
  it("own_site_breakage: the emptied soft page answers alert and the healthy page stays clear", async () => {
    const states = await fixtureStates();
    const seenPs: string[] = [];
    const report = await runEval(
      D3S_BREAKAGE.id,
      rows,
      (row) => {
        const state = states[row.id];
        if (state === undefined) throw new Error(`no judged state for ${row.id}`);
        return makeNoulAsk(D3S_BREAKAGE)(state).then((call) => {
          if (call.p !== null) seenPs.push(`${row.id}: p=${call.p.toFixed(3)} -> ${noulAction(call.p)}`);
          return call;
        });
      },
      noulScore,
    );
    console.log(`raw ps:\n${seenPs.join("\n")}\n${formatReport(report)}`);
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
