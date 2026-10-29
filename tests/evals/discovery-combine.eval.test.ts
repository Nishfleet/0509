import { afterAll, describe, expect, it, vi } from "vitest";

import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import {
  IS_COMPETITOR,
  SAME_CATEGORY,
  competitorState,
  keepOnlyIfBoth,
  type ResolvedCandidate,
} from "../../app/lib/discovery/run.server";
import { ACT_AT } from "../../app/lib/jev/thresholds";
import {
  formatReport,
  jevKeyPresent,
  loadCases,
  makeNoulsAsk,
  noulScore,
  runEval,
  type Ask,
  type DiscoveryCase,
} from "./harness";

vi.mock("../../app/lib/data/takedown.server", () => ({ takenDownAmong: () => Promise.resolve(new Set()) }));
vi.mock("../../app/lib/jev/client.server", () => ({
  askNoul: () => Promise.resolve(null),
  askNouls: () => Promise.resolve([]),
  askChoice: () => Promise.resolve(null),
  JevUnavailableError: class JevUnavailableError extends Error {},
}));
vi.mock("../../app/lib/discovery/resolve-domain.server", () => ({
  resolveDomain: () => Promise.resolve({ domain: null }),
}));
vi.mock("../../app/lib/discovery/generators/news", () => ({ newsGenerator: () => Promise.resolve([]) }));
vi.mock("../../app/lib/discovery/generators/hn", () => ({ hnGenerator: () => Promise.resolve([]) }));
vi.mock("../../app/lib/discovery/generators/ai", () => ({ aiGenerator: () => Promise.resolve([]) }));

const CATEGORY_FLOOR = 0.5;
const QUESTIONS = [IS_COMPETITOR, SAME_CATEGORY];
const CATEGORY_INDEX = QUESTIONS.indexOf(SAME_CATEGORY);

interface Recorded {
  model: string;
  ps: number[];
}

const answers = new Map<string, Recorded[]>();
const replayed = new Map<string, number>();
let beforeScore: number | null = null;

function stateFor(row: DiscoveryCase): unknown {
  const context: DiscoveryContext = {
    self: {
      workspaceId: `eval-${row.id}`,
      name: row.self.name,
      domain: row.self.domain,
      description: row.self.description,
      kind: row.kind,
    },
    competitors: row.competitors,
    knownDomains: [],
    dismissedDomains: [],
  };
  const candidate: ResolvedCandidate = {
    name: row.item.name,
    domain: row.item.domain,
    evidence: row.item.evidence.map((item) => ({ ...item, sourceUrl: item.source, generator: "news" as const })),
    line: row.item.evidence.map((item) => item.excerpt).join("; "),
  };
  return competitorState(context, candidate);
}

function liftClearYes(p: number): number {
  if (p < CATEGORY_FLOOR) return p;
  return ACT_AT + ((p - CATEGORY_FLOOR) * (1 - ACT_AT)) / (1 - CATEGORY_FLOOR);
}

function lowest(ps: number[]): number {
  const [first, ...rest] = ps;
  if (first === undefined) throw new Error("no answers to combine");
  return Math.min(first, ...rest);
}

function offCategory(ps: number[]): boolean {
  const category = ps[CATEGORY_INDEX];
  return category !== undefined && category < CATEGORY_FLOOR;
}

function combineBefore(ps: number[]): number {
  return offCategory(ps) ? 0 : liftClearYes(lowest(ps));
}

function combineAfter(ps: number[]): number {
  return offCategory(ps) ? 0 : lowest(ps);
}

function shippedCombine(ps: number[]): number {
  const verdicts: Parameters<typeof keepOnlyIfBoth>[0] = ps.map((p, index) => ({
    questionId: `probe-${String(index)}`,
    inputHash: "",
    p,
    cached: false,
  }));
  return keepOnlyIfBoth(verdicts).p;
}

const beforeAsk: Ask<DiscoveryCase> = async (row) => {
  let raw: number[] = [];
  const ask = makeNoulsAsk(QUESTIONS, (ps) => {
    raw = ps;
    return combineBefore(ps);
  });
  const call = await ask(stateFor(row));
  if (raw.length !== QUESTIONS.length) {
    throw new Error(`${row.id} answered ${String(raw.length)} of ${String(QUESTIONS.length)} questions`);
  }
  const bucket = answers.get(row.id) ?? [];
  answers.set(row.id, bucket);
  bucket.push({ model: call.model, ps: [...raw] });
  return call;
};

const afterAsk: Ask<DiscoveryCase> = (row) => {
  const bucket = answers.get(row.id) ?? [];
  const index = replayed.get(row.id) ?? 0;
  replayed.set(row.id, index + 1);
  const recorded = bucket[index];
  if (recorded === undefined) throw new Error(`no recorded answer for ${row.id} repeat ${String(index)}`);
  return Promise.resolve({ model: recorded.model, p: combineAfter(recorded.ps), choice: null });
};

function liftBand(): string {
  const mins = [...answers.values()].flat().map((recorded) => lowest(recorded.ps));
  const promoted = mins.filter((p) => p >= CATEGORY_FLOOR && p < ACT_AT).length;
  const acting = mins.filter((p) => p >= ACT_AT).length;
  const below = mins.filter((p) => p < CATEGORY_FLOOR).length;
  return `lift band\tanswers ${String(mins.length)}\tthe lift turned into act ${String(promoted)}\talready act ${String(acting)}\tbelow the floor ${String(below)}`;
}

afterAll(() => {
  for (const [id, bucket] of answers) {
    expect(replayed.get(id) ?? 0, `replayed answers for ${id}`).toBe(bucket.length);
  }
});

describe("pinned discovery combines", () => {
  it("matches the shipped combine on both sides of PR #7667, so a third behaviour shows up here", () => {
    const probes = [0.2, 0.55, 0.9].flatMap((competitor) =>
      [0.3, 0.5, 0.52, 0.7, 0.95].map((category) => [competitor, category]),
    );
    for (const ps of probes) {
      expect([combineBefore(ps), combineAfter(ps)], ps.join("/")).toContain(shippedCombine(ps));
    }
  });
});

describe.skipIf(!jevKeyPresent())("eval: the discovery combine before and after the clear-yes lift was removed", () => {
  it("candidate_keep_before_7667: scores the combine with the clear-yes lift on the same_category rows", async () => {
    const rows = await loadCases<DiscoveryCase>("same_category", ["kind", "self", "competitors", "item", "label"]);
    const report = await runEval("candidate_keep_before_7667", rows, beforeAsk, noulScore);
    console.log(formatReport(report));
    const [split] = report.splits;
    expect(split).toBeDefined();
    if (split === undefined) throw new Error("the before run scored no split");
    expect(split.cases).toBeGreaterThan(0);
    expect(split.calls).toBe(split.cases * report.repeats);
    beforeScore = split.score;
  });

  it("candidate_keep_after_7667: scores the combine without the lift from the same answers, with no further calls", async () => {
    const rows = await loadCases<DiscoveryCase>("same_category", ["kind", "self", "competitors", "item", "label"]);
    const report = await runEval("candidate_keep_after_7667", rows, afterAsk, noulScore, 0);
    console.log(formatReport(report));
    console.log(liftBand());
    const [split] = report.splits;
    expect(split).toBeDefined();
    if (split === undefined) throw new Error("the after run scored no split");
    expect(split.cases).toBeGreaterThan(0);
    expect(report.callsUsed).toBe(0);
    if (beforeScore === null) throw new Error("the before run did not record a score");
    expect(split.score).toBeLessThanOrEqual(beforeScore + 1e-9);
  });
});
