import { describe, expect, it, vi } from "vitest";

import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import { SAME_CATEGORY, competitorState, type ResolvedCandidate } from "../../app/lib/discovery/run.server";
import { formatReport, jevKeyPresent, loadCases, makeNoulAsk, runEval, type Ask, type DiscoveryCase } from "./harness";

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

const SPACING_MS = 2000;
let gate: Promise<unknown> = Promise.resolve();

function paced<T>(call: () => Promise<T>): Promise<T> {
  const turn = gate.then(() => call());
  gate = turn.then(
    () => new Promise((resolve) => setTimeout(resolve, SPACING_MS)),
    () => new Promise((resolve) => setTimeout(resolve, SPACING_MS)),
  );
  return turn;
}

const SHARED_TAIL =
  " A shoe brand and a clothing brand are different categories even when both are sustainable and sold to the same people; a meal kit and a restaurant are different categories. `self.description` says what `self` sells and `item.evidence` says what `item` sells.";

const OLD = {
  ...SAME_CATEGORY,
  instructions:
    "Does `item` mainly sell the same kind of product or service that `self` mainly sells? Judge the product category: what a customer actually buys from each. Do not count shared values, audience, price, style or business model." +
    SHARED_TAIL,
  whenTrue:
    "What `item` mainly sells is the same kind of product or service as what `self` mainly sells, so a buyer shopping for one would consider the other.",
};

const V3 = {
  ...SAME_CATEGORY,
  instructions: SAME_CATEGORY.instructions.replace(
    " A shoe brand",
    " Selling something that goes with the product, such as bedding for a mattress, is not selling the product itself. A shoe brand",
  ),
  whenFalse: `${SAME_CATEGORY.whenFalse} Something that goes with the product, rather than the product itself, also counts as different.`,
};

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

async function probe(name: string, question: typeof SAME_CATEGORY, only: (row: DiscoveryCase) => boolean) {
  const all = await loadCases<DiscoveryCase>("same_category", ["kind", "self", "competitors", "item", "label"]);
  const rows = all.filter(only);
  const ask: Ask<DiscoveryCase> = (row) =>
    paced(async () => {
      const call = await makeNoulAsk(question)(stateFor(row));
      console.log(
        `CAT\t${name}\t${row.split}\t${String(row.label)}\t${row.self.name}->${row.item.name}\t${call.p.toFixed(3)}`,
      );
      return call;
    });
  const report = await runEval(name, rows, ask, (row, call) => ({
    points: (call.p ?? 0) >= 0.5 === row.label ? 1 : 0,
    uncertain: false,
    key: (call.p ?? 0) >= 0.5 ? "keep" : "drop",
  }));
  console.log(formatReport(report));
  return report;
}

const NEWEST = new Set(["Dyson", "Notion", "Sleep Number", "Mailchimp", "Duolingo", "Dropbox"]);

describe.skipIf(!jevKeyPresent())("probe: category wording per case", () => {
  it("category_shipped_branch", async () => {
    expect((await probe("category_new", SAME_CATEGORY, () => true)).splits.length).toBeGreaterThan(0);
  });
  it("category_v3", async () => {
    expect((await probe("category_v3", V3, () => true)).splits.length).toBeGreaterThan(0);
  });
  it("category_old_on_newest", async () => {
    expect((await probe("category_old", OLD, (row) => NEWEST.has(row.self.name))).splits.length).toBeGreaterThan(0);
  });
});
