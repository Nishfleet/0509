import { parse } from "tldts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { DiscoveryContext } from "../../app/lib/data/entity.server";
import {
  IS_COMPETITOR,
  IS_CREATOR_RIVAL,
  SAME_CATEGORY,
  competitorState,
  keepOnlyIfBoth,
  type ResolvedCandidate,
} from "../../app/lib/discovery/run.server";
import { MAX_TOKENS, MODEL, RESPONSE_SCHEMA, messagesFor } from "../../app/lib/discovery/generators/ai.server";
import { REJECT_AT } from "../../app/lib/jev/thresholds";
import {
  formatReport,
  jevKeyPresent,
  loadCases,
  makeNoulAsk,
  makeNoulsAsk,
  noulScore,
  postWorkersAi,
  runEval,
  type Ask,
  type DiscoveryCase,
  type EvalRow,
  type Score,
} from "./harness";

vi.mock("../../app/lib/data/takedown.server", () => ({ takenDownAmong: () => Promise.resolve(new Set()) }));
vi.mock("../../app/lib/jev/client.server", () => ({
  askNoul: () => Promise.resolve(null),
  askNouls: () => Promise.resolve([]),
  askChoice: () => Promise.resolve(null),
  GATEWAY_ID: "default",
  JevUnavailableError: class JevUnavailableError extends Error {},
}));
vi.mock("../../app/lib/fetch/outbound.server", () => ({
  fetchOutbound: () => Promise.reject(new Error("no network")),
}));
vi.mock("../../app/lib/fetch/robots.server", () => ({ CRAWLER_USER_AGENT: "eval" }));
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

interface SeededCase extends EvalRow {
  self: { name: string; domain: string; description: string };
  site: { title: string; description: string };
  expected: string[][];
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
  it("proposer_seeded: recall of the first pass versus first pass plus a pass seeded with the confirmed rivals", async () => {
    const rows = await loadCases<SeededCase>("proposer_recall", ["self", "site", "expected"]);
    const domainsOnly = z.object({ competitors: z.array(z.object({ name: z.string(), domain: z.string() })) });
    const registrable = (value: string): string => parse(value).domain ?? value.toLowerCase();
    const propose = async (row: SeededCase, found: string[]): Promise<{ name: string; domain: string }[]> => {
      const subject = { name: row.self.name, domain: row.self.domain, description: row.self.description };
      const result = (await postWorkersAi(MODEL, {
        messages: messagesFor(subject, row.site, found),
        response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
        max_tokens: MAX_TOKENS,
      })) as { response?: unknown };
      const body: unknown = typeof result.response === "string" ? JSON.parse(result.response) : result.response;
      return domainsOnly.parse(body).competitors;
    };
    const keeps = async (row: SeededCase, item: { name: string; domain: string }): Promise<boolean> => {
      const state = {
        self: { name: row.self.name, domain: row.self.domain, description: row.self.description },
        competitor_set: [],
        item: {
          name: item.name,
          domain: item.domain,
          evidence: [
            {
              source: row.self.domain,
              excerpt:
                "Proposed by a language model reading the brand's own site; not corroborated by any other source",
            },
          ],
        },
        user_memory: { dismissed_domains: [] },
        reliability: { hn: "best_effort" },
      };
      const combine = (ps: number[]): number =>
        keepOnlyIfBoth(ps.map((p) => ({ questionId: "", inputHash: "", p, cached: false }))).p;
      for (let attempt = 0; ; attempt++) {
        try {
          const call = await makeNoulsAsk([IS_COMPETITOR, SAME_CATEGORY], combine)(state);
          return (call.p ?? 0) > REJECT_AT;
        } catch (error) {
          if (attempt >= 3) throw error;
        }
      }
    };
    const recall = (row: SeededCase, domains: Set<string>): number =>
      row.expected.filter((aliases) => aliases.some((alias) => domains.has(registrable(alias)))).length /
      row.expected.length;
    type Arm = "one" | "union2" | "seeded";
    const shownByRun = new Map<string, Set<string>[]>();
    const keptOf = async (
      row: SeededCase,
      items: { name: string; domain: string }[],
    ): Promise<{ name: string; domain: string }[]> => {
      const kept: { name: string; domain: string }[] = [];
      for (const item of items) if (await keeps(row, item)) kept.push(item);
      return kept;
    };
    const ask =
      (arm: Arm): Ask<SeededCase> =>
      async (row) => {
        const first = await propose(row, []);
        const second = arm === "one" ? [] : await propose(row, arm === "seeded" ? first.map((item) => item.name) : []);
        const seen = new Set<string>();
        const items = [...first, ...second].filter((item) => {
          const domain = registrable(item.domain);
          if (seen.has(domain)) return false;
          seen.add(domain);
          return true;
        });
        const kept = arm === "seeded" ? await keptOf(row, first) : [];
        const rest =
          arm === "seeded"
            ? await keptOf(
                row,
                second.filter((item) => !kept.some((k) => registrable(k.domain) === registrable(item.domain))),
              )
            : await keptOf(row, items);
        const domains = new Set([...kept, ...rest].map((item) => registrable(item.domain)));
        const key = `${arm}|${row.self.domain}`;
        shownByRun.set(key, [...(shownByRun.get(key) ?? []), domains]);
        return { model: MODEL, p: null, choice: [...domains].join(",") };
      };
    const score: Score<SeededCase> = (row, call) => {
      const points = recall(row, new Set((call.choice ?? "").split(",").filter((entry) => entry !== "")));
      return { points, uncertain: false, key: points.toFixed(2) };
    };
    const jaccard = (a: Set<string>, b: Set<string>): number => {
      const union = new Set([...a, ...b]).size;
      return union === 0 ? 1 : [...a].filter((x) => b.has(x)).length / union;
    };
    const stability = (arm: Arm): number => {
      const scores: number[] = [];
      for (const [key, runs] of shownByRun) {
        if (!key.startsWith(`${arm}|`)) continue;
        for (let i = 0; i < runs.length; i++)
          for (let j = i + 1; j < runs.length; j++) scores.push(jaccard(runs[i]!, runs[j]!));
      }
      return scores.reduce((sum, v) => sum + v, 0) / Math.max(scores.length, 1);
    };
    const per = 2 + 10 * 2 * 2;
    for (const arm of ["one", "union2", "seeded"] as const) {
      const report = await runEval(`proposer_stability_${arm}`, rows, ask(arm), score, per);
      console.log(formatReport(report));
      console.log(`STABILITY ${arm} mean_pairwise_jaccard=${stability(arm).toFixed(3)}`);
      expect(report.splits.length).toBeGreaterThan(0);
    }
  });
});
