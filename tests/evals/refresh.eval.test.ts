import { describe, expect, it, vi } from "vitest";

import type { DiscoveryContext, RefreshTarget } from "../../app/lib/data/entity.server";
import type { RecentSignal } from "../../app/lib/data/signal.server";
import {
  STILL_COMPETITOR,
  STILL_COMPETITOR_REASON,
  stillCompetitorState,
} from "../../app/lib/discovery/refresh.server";
import {
  formatReport,
  jevKeyPresent,
  loadStillCases,
  makeAsk,
  makeChoiceAsk,
  runChoiceEval,
  runStillEval,
  type StillCase,
} from "./harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("../../app/lib/jev/client.server", () => ({
  askNoul: () => Promise.resolve(null),
  askChoice: () => Promise.resolve(null),
  JevUnavailableError: class JevUnavailableError extends Error {},
}));
vi.mock("../../app/lib/data/signal.server", () => ({
  readRecentSignals: () => Promise.resolve([]),
}));

// The shipped production state builder, fed exactly what a refresh target
// carries, so the judged state is the state the 30-day refresh judges.
function stateFor(row: StillCase): unknown {
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
  const target: RefreshTarget = {
    entityId: `eval-${row.id}`,
    name: row.subject.name,
    domain: row.subject.domain,
    origin: "auto",
  };
  const history: RecentSignal[] = row.history.map((signal) => ({ ...signal }));
  return stillCompetitorState(context, target, history);
}

describe.skipIf(!jevKeyPresent())("eval: still-a-competitor questions against Jev", () => {
  it("still_competitor: scores the shipped STILL_COMPETITOR text on both splits", async () => {
    await loadStillCases("still_competitor");
    const ask = async (row: StillCase) => (await makeAsk(STILL_COMPETITOR))(stateFor(row));
    const report = await runStillEval("still_competitor", ask);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("still_competitor_reason: scores the shipped STILL_COMPETITOR_REASON text on both splits", async () => {
    const choices = Object.keys(STILL_COMPETITOR_REASON.options);
    await loadStillCases("still_competitor_reason", choices);
    const ask = async (row: StillCase) => (await makeChoiceAsk(STILL_COMPETITOR_REASON))(stateFor(row));
    const report = await runChoiceEval("still_competitor_reason", ask, choices);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
