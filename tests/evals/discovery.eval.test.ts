import { describe, expect, it, vi } from "vitest";

import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import {
  IS_COMPETITOR,
  IS_CREATOR_RIVAL,
  SAME_CATEGORY,
  competitorState,
  keepOnlyIfBoth,
  type ResolvedCandidate,
} from "../../app/lib/discovery/run.server";
import { REJECT_AT } from "../../app/lib/jev/thresholds";
import {
  formatReport,
  jevKeyPresent,
  loadCases,
  makeNoulAsk,
  makeNoulsAsk,
  noulScore,
  runEval,
  type Ask,
  type DiscoveryCase,
  type Score,
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

// The shipped production state builder, fed exactly what a ResolvedCandidate
// carries in discovery, so the judged state is the state onboarding judges.
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

describe.skipIf(!jevKeyPresent())("eval: discovery competitor questions against Jev", () => {
  it("is_competitor: scores the shipped IS_COMPETITOR text on both splits", async () => {
    const rows = await loadCases<DiscoveryCase>("is_competitor", ["kind", "self", "competitors", "item", "label"]);
    const ask: Ask<DiscoveryCase> = (row) => makeNoulAsk(IS_COMPETITOR)(stateFor(row));
    const score: Score<DiscoveryCase> = noulScore;
    const report = await runEval("is_competitor", rows, ask, score);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("is_creator_rival: scores the shipped IS_CREATOR_RIVAL text on both splits", async () => {
    const rows = await loadCases<DiscoveryCase>("is_creator_rival", ["kind", "self", "competitors", "item", "label"]);
    const ask: Ask<DiscoveryCase> = (row) => makeNoulAsk(IS_CREATOR_RIVAL)(stateFor(row));
    const score: Score<DiscoveryCase> = noulScore;
    const report = await runEval("is_creator_rival", rows, ask, score);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("candidate_keep_baseline: scores IS_COMPETITOR alone on AI-proposed candidates", async () => {
    const rows = await loadCases<DiscoveryCase>("same_category", ["kind", "self", "competitors", "item", "label"]);
    const ask: Ask<DiscoveryCase> = (row) => makeNoulAsk(IS_COMPETITOR)(stateFor(row));
    const report = await runEval("candidate_keep_baseline", rows, ask, noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("candidate_keep_with_category: scores IS_COMPETITOR plus SAME_CATEGORY as shipped", async () => {
    const rows = await loadCases<DiscoveryCase>("same_category", ["kind", "self", "competitors", "item", "label"]);
    const combine = (ps: number[]): number =>
      keepOnlyIfBoth(ps.map((p) => ({ questionId: "", inputHash: "", p, cached: false }))).p;
    const ask: Ask<DiscoveryCase> = (row) => makeNoulsAsk([IS_COMPETITOR, SAME_CATEGORY], combine)(stateFor(row));
    const report = await runEval("candidate_keep_with_category", rows, ask, noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
  it.each([0.1, 0.4, 0.5, 0.6])(
    "candidate_shown_category_floor_%s: scores what a customer would see with a category floor",
    async (floor) => {
      const rows = await loadCases<DiscoveryCase>("same_category", ["kind", "self", "competitors", "item", "label"]);
      const combine = (ps: number[]): number => {
        const [competitor = 0, category = 0] = ps;
        return category < floor ? 0 : Math.min(competitor, category);
      };
      const ask: Ask<DiscoveryCase> = (row) => makeNoulsAsk([IS_COMPETITOR, SAME_CATEGORY], combine)(stateFor(row));
      const shown: Score<DiscoveryCase> = (row, call) => {
        const visible = (call.p ?? 0) > REJECT_AT;
        return { points: visible === row.label ? 1 : 0, uncertain: false, key: visible ? "shown" : "hidden" };
      };
      const report = await runEval(`candidate_shown_category_floor_${String(floor)}`, rows, ask, shown);
      console.log(formatReport(report));
      expect(report.splits.length).toBeGreaterThan(0);
    },
  );
});
