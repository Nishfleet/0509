import { describe, expect, it, vi } from "vitest";

import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import {
  IS_COMPETITOR,
  SAME_CATEGORY,
  competitorState,
  type ResolvedCandidate,
} from "../../app/lib/discovery/run.server";
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

const V1 = {
  ...SAME_CATEGORY,
  instructions:
    "Would a buyer shopping for what `self` mainly sells consider buying one of `item`'s products instead? Judge what customers actually buy, not shared values, audience, price, style or business model. The shape of the product does not matter: a ring, a band and a watch that all track sleep are the same category. Nor does the size of `item`: if it is a large company that sells many things, judge the product of `item` closest to what `self` sells." +
    SHARED_TAIL,
  whenTrue:
    "A product that `item` sells serves the same need as what `self` mainly sells, so a buyer shopping for one would consider the other, even in a different form or from a company with many other products.",
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

const NEW_BRANDS = new Set(["Oura", "Vercel", "GoPro", "Sonos"]);
const NEW_SPOTIFY = new Set(["Apple Music", "Amazon Music", "Sonos"]);

function isNew(row: DiscoveryCase): boolean {
  return NEW_BRANDS.has(row.self.name) || (row.self.name === "Spotify" && NEW_SPOTIFY.has(row.item.name));
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

describe.skipIf(!jevKeyPresent())("probe: category wording per case", () => {
  it("category_base", async () => {
    expect((await probe("category_base", SAME_CATEGORY, () => true)).splits.length).toBeGreaterThan(0);
  });
  it("category_v1", async () => {
    expect((await probe("category_v1", V1, () => true)).splits.length).toBeGreaterThan(0);
  });
  it("is_competitor_new_cases", async () => {
    expect((await probe("is_competitor_new", IS_COMPETITOR, isNew)).splits.length).toBeGreaterThan(0);
  });
});
