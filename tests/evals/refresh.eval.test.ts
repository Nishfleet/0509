import { describe, expect, it, vi } from "vitest";

import type { DiscoveryContext, RefreshTarget } from "../../app/lib/data/entity.server";
import type { RecentSignal } from "../../app/lib/data/signal.server";
import {
  STILL_COMPETITOR,
  STILL_COMPETITOR_REASON,
  stillCompetitorState,
} from "../../app/lib/discovery/refresh.server";
import {
  choiceScore,
  formatReport,
  jevKeyPresent,
  loadCases,
  makeChoiceAsk,
  makeNoulAsk,
  noulScore,
  runEval,
  type ChoiceEvalRow,
  type NoulEvalRow,
} from "./harness";

interface StillFields {
  kind: "domain" | "creator";
  self: { name: string; domain: string; description: string | null };
  competitors: { name: string; domain: string }[];
  subject: { name: string; domain: string };
  history: {
    kind: string;
    title: string | null;
    summary: string;
    url: string;
    aspect: string | null;
    observed_at: string;
  }[];
}

type StillCase = NoulEvalRow & StillFields;

type StillReasonCase = ChoiceEvalRow & StillFields;

const STILL_FIELDS = ["kind", "self", "competitors", "subject", "history"] as const;

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
function stateFor(row: StillFields & { id: string }): unknown {
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
    const rows = await loadCases<StillCase>("still_competitor", STILL_FIELDS);
    const askOne = makeNoulAsk(STILL_COMPETITOR);
    const report = await runEval("still_competitor", rows, (row) => askOne(stateFor(row)), noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });

  it("still_competitor_reason: scores the shipped STILL_COMPETITOR_REASON text on both splits", async () => {
    const rows = await loadCases<StillReasonCase>("still_competitor_reason", STILL_FIELDS, {
      file: "still_competitor",
      project: (entry) => ({ ...(entry as object), label: (entry as { labelChoice: string }).labelChoice }),
    });
    const askOne = makeChoiceAsk(STILL_COMPETITOR_REASON);
    const report = await runEval("still_competitor_reason", rows, (row) => askOne(stateFor(row)), choiceScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
