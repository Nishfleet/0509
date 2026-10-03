import { describe, expect, it, vi } from "vitest";

import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import {
  IS_COMPETITOR,
  SAME_CATEGORY,
  competitorState,
  type ResolvedCandidate,
} from "../../app/lib/discovery/run.server";
import { jevKeyPresent, loadCases, makeNoulsAsk, noulScore, runEval, type Ask, type DiscoveryCase } from "./harness";

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

const ALLBIRDS = {
  name: "Allbirds",
  domain: "allbirds.com",
  description: "Sustainable footwear and apparel made from natural materials",
};

function allbirdsRow(name: string, domain: string, label: boolean, reason: string): DiscoveryCase {
  return {
    id: `allbirds-${domain}`,
    split: "test",
    why: "allbirds candidate",
    label,
    kind: "domain",
    self: ALLBIRDS,
    competitors: [],
    item: {
      name,
      domain,
      evidence: [
        {
          source: "allbirds.com",
          excerpt: `Proposed by a language model reading the brand's own site; not corroborated by any other source. Its reason: ${reason}`,
        },
      ],
    },
  };
}

const EXTRA: DiscoveryCase[] = [
  allbirdsRow("Cariuma", "cariuma.com", true, "Sustainable sneakers for the same buyers."),
  allbirdsRow("TOMS", "toms.com", true, "Casual shoes brand with a social mission, sold to the same buyers."),
  allbirdsRow("Veja", "veja-store.com", true, "Eco-minded sneaker brand."),
  allbirdsRow("Rothy's", "rothys.com", true, "Washable shoes made from recycled materials."),
  allbirdsRow("Native Shoes", "nativeshoes.com", true, "Lightweight molded casual shoes."),
  allbirdsRow("Vans", "vans.com", true, "Casual sneakers for everyday wear."),
  allbirdsRow("New Balance", "newbalance.com", true, "Everyday sneakers and running shoes."),
  allbirdsRow("On", "on.com", true, "Performance and lifestyle running shoes."),
  allbirdsRow("Hoka", "hoka.com", true, "Cushioned running shoes."),
  allbirdsRow("Stripe", "stripe.com", false, "Payments company."),
  allbirdsRow("Notion", "notion.so", false, "Workspace software."),
  allbirdsRow("Peloton", "onepeloton.com", false, "Connected fitness equipment."),
];

const seen: string[] = [];

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function paced<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    await pause(1_500);
    try {
      return await call();
    } catch (error) {
      if (!String(error).includes("2003") || attempt >= 4) throw error;
      await pause(15_000);
    }
  }
}

function recordingAsk(): Ask<DiscoveryCase> {
  return async (row) => {
    const combine = (ps: number[]): number => {
      seen.push(`${row.id}\t${row.label ? "rival" : "not"}\tcompetitor ${String(ps[0])}\tcategory ${String(ps[1])}`);
      const [competitor = 0, category = 0] = ps;
      return category < 0.5 ? 0 : Math.min(competitor, category);
    };
    return paced(() => makeNoulsAsk([IS_COMPETITOR, SAME_CATEGORY], combine)(stateFor(row)));
  };
}

describe.skipIf(!jevKeyPresent())("probe: Clef on the two rival questions", () => {
  it("scores the held-out cases and the Allbirds candidates, one call per row per repeat", async () => {
    const cases = await loadCases<DiscoveryCase>("same_category", ["kind", "self", "competitors", "item", "label"]);
    const rows = [...cases.filter((row) => row.split === "test"), ...EXTRA];
    const report = await runEval("clef_rivals", rows, recordingAsk(), noulScore);
    console.log(`calls ${String(report.callsUsed)}/${String(report.callBudget)} model ${report.model}`);
    console.log(seen.join("\n"));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
