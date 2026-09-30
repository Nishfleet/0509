import { describe, expect, it, vi } from "vitest";

import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import {
  IS_COMPETITOR,
  IS_CREATOR_RIVAL,
  competitorState,
  type ResolvedCandidate,
} from "../../app/lib/discovery/run.server";
import { formatReport, jevKeyPresent, loadCases, makeAsk, runEval, type EvalCase } from "./harness";

vi.mock("../../app/lib/data/takedown.server", () => ({ takenDownAmong: () => Promise.resolve(new Set()) }));
vi.mock("../../app/lib/jev/client.server", () => ({
  askNoul: () => Promise.resolve(null),
  JevUnavailableError: class JevUnavailableError extends Error {},
}));
vi.mock("../../app/lib/discovery/resolve-domain.server", () => ({
  resolveDomain: () => Promise.resolve({ domain: null }),
}));
vi.mock("../../app/lib/discovery/generators/news", () => ({ newsGenerator: () => Promise.resolve([]) }));
vi.mock("../../app/lib/discovery/generators/hn", () => ({ hnGenerator: () => Promise.resolve([]) }));

// The shipped production state builder, fed exactly what a ResolvedCandidate
// carries in discovery, so the judged state is the state onboarding judges.
function stateFor(row: EvalCase): unknown {
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
    await loadCases("is_competitor");
    const ask = async (row: EvalCase) => (await makeAsk(IS_COMPETITOR))(stateFor(row));
    const report = await runEval("is_competitor", ask);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("is_creator_rival: scores the shipped IS_CREATOR_RIVAL text on both splits", async () => {
    await loadCases("is_creator_rival");
    const ask = async (row: EvalCase) => (await makeAsk(IS_CREATOR_RIVAL))(stateFor(row));
    const report = await runEval("is_creator_rival", ask);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
