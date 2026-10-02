import { parse } from "tldts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  MAX_TOKENS,
  MODEL,
  RESPONSE_FORMAT,
  messagesFor,
  proposalBody,
} from "../../app/lib/discovery/generators/ai.server";
import { IS_COMPETITOR, SAME_CATEGORY, keepOnlyIfBoth } from "../../app/lib/discovery/run.server";
import { REJECT_AT } from "../../app/lib/jev/thresholds";
import {
  formatReport,
  loadCases,
  makeNoulsAsk,
  postWorkersAi,
  runEval,
  workersAiPresent,
  type Ask,
  type EvalRow,
  type Score,
} from "./harness";

vi.mock("../../app/lib/data/takedown.server", () => ({ takenDownAmong: () => Promise.resolve(new Set()) }));
vi.mock("../../app/lib/fetch/outbound.server", () => ({
  fetchOutbound: () => Promise.reject(new Error("no network")),
}));
vi.mock("../../app/lib/fetch/robots.server", () => ({ CRAWLER_USER_AGENT: "eval" }));
vi.mock("../../app/lib/jev/client.server", () => ({
  askNoul: () => Promise.resolve(null),
  askNouls: () => Promise.resolve([]),
  askChoice: () => Promise.resolve(null),
  GATEWAY_ID: "default",
  JevUnavailableError: class JevUnavailableError extends Error {},
}));
vi.mock("../../app/lib/discovery/resolve-domain.server", () => ({
  resolveDomain: () => Promise.resolve({ domain: null }),
}));
vi.mock("../../app/lib/discovery/generators/news", () => ({ newsGenerator: () => Promise.resolve([]) }));
vi.mock("../../app/lib/discovery/generators/hn", () => ({ hnGenerator: () => Promise.resolve([]) }));
vi.mock("../../app/lib/discovery/generators/ai", () => ({ aiGenerator: () => Promise.resolve([]) }));

interface Row extends EvalRow {
  self: { name: string; domain: string; description: string };
  site: { title: string; description: string };
  expected: string[][];
}

interface Arm {
  id: string;
  samples: number;
  reasoning?: "low" | "medium" | "high";
  context?: boolean;
  extra?: string;
  models?: string[];
  grace?: number | null;
}

const SELLS_FIRST =
  " Choose competitors by what they sell, not by values, style or audience: include the best-known brands that sell the same kind of product to the same customers, even when their brand image is very different.";

const NEMOTRON = "@cf/nvidia/nemotron-3-120b-a12b";

const GLM53 = "@cf/zai-org/glm-5.3";
const GLM52 = "@cf/zai-org/glm-5.2";
const KIMI25 = "@cf/moonshotai/kimi-k2.5";

const ARMS: Arm[] = [
  { id: "both_full", samples: 2, models: [MODEL, NEMOTRON], grace: null },
  { id: "grace4", samples: 2, models: [MODEL, NEMOTRON], grace: 4_000 },
  { id: "grace2", samples: 2, models: [MODEL, NEMOTRON], grace: 2_000 },
  { id: "first_only", samples: 2, models: [MODEL, NEMOTRON], grace: 0 },
  { id: "nemo_only", samples: 1, models: [NEMOTRON], grace: null },
];

const registrable = (value: string): string => parse(value).domain ?? value.toLowerCase();
const proposals = z.object({ competitors: z.array(z.object({ name: z.string(), domain: z.string() })) });

async function withTimeout(call: Promise<unknown>): Promise<unknown> {
  return Promise.race([call, new Promise<null>((resolve) => setTimeout(() => resolve(null), 90_000))]);
}

function withExtra(
  messages: ReturnType<typeof messagesFor>,
  extra: string | undefined,
): ReturnType<typeof messagesFor> {
  if (extra === undefined) return messages;
  return messages.map((m) => (m.role === "system" ? { ...m, content: m.content + extra } : m));
}

function messagesWithContext(row: Row): ReturnType<typeof messagesFor> {
  const base = messagesFor(
    { name: row.self.name, domain: row.self.domain, description: row.self.description },
    row.site,
  );
  const [system, user] = base;
  return [
    {
      role: "system",
      content: `${system?.content ?? ""} The field same_category_test is the test every brand you name must pass.`,
    },
    {
      role: "user",
      content: JSON.stringify({
        ...(JSON.parse(user?.content ?? "{}") as object),
        same_category_test: SAME_CATEGORY.instructions,
      }),
    },
  ];
}

describe.skipIf(!workersAiPresent())("hillclimb: gpt-oss proposer arms", () => {
  it.each(ARMS)(
    "arm $id",
    async (arm) => {
      const rows = await loadCases<Row>("proposer_recall", ["self", "site", "expected"]);
      const shown = new Map<string, Set<string>[]>();
      let ms = 0;
      let calls = 0;
      let timeouts = 0;
      const walls: number[] = [];
      const propose = async (row: Row, model: string): Promise<{ name: string; domain: string }[]> => {
        const started = Date.now();
        const result = await withTimeout(
          postWorkersAi(model, {
            messages: arm.context
              ? messagesWithContext(row)
              : messagesFor(
                  { name: row.self.name, domain: row.self.domain, description: row.self.description },
                  row.site,
                ),
            response_format: RESPONSE_FORMAT,
            max_tokens: MAX_TOKENS,
            ...(arm.reasoning === undefined ? {} : { reasoning: { effort: arm.reasoning } }),
          }),
        );
        ms += Date.now() - started;
        calls += 1;
        if (result === null) {
          timeouts += 1;
          return [];
        }
        const parsed = proposals.safeParse(proposalBody(result));
        return parsed.success ? parsed.data.competitors : [];
      };
      const keeps = async (row: Row, item: { name: string; domain: string }): Promise<boolean> => {
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
      const ask: Ask<Row> = async (row) => {
        const started = Date.now();
        const pending = Array.from({ length: arm.samples }, (_, index) => propose(row, arm.models?.[index] ?? MODEL));
        let batches: { name: string; domain: string }[][];
        if (arm.grace === null || arm.grace === undefined) {
          batches = await Promise.all(pending);
        } else {
          const settled: ({ name: string; domain: string }[] | null)[] = pending.map(() => null);
          const tracked = pending.map((promise, index) =>
            promise.then((value) => {
              settled[index] = value;
            }),
          );
          await Promise.race(tracked);
          await Promise.race([
            Promise.all(tracked),
            new Promise<void>((resolve) => setTimeout(resolve, arm.grace ?? 0)),
          ]);
          batches = settled.map((value) => value ?? []);
        }
        walls.push(Date.now() - started);
        const unique = new Map<string, { name: string; domain: string }>();
        for (const item of batches.flat()) unique.set(registrable(item.domain), item);
        const kept: string[] = [];
        for (const item of unique.values()) if (await keeps(row, item)) kept.push(registrable(item.domain));
        shown.set(row.self.domain, [...(shown.get(row.self.domain) ?? []), new Set(kept)]);
        return { model: MODEL, p: null, choice: kept.join(",") };
      };
      const score: Score<Row> = (row, call) => {
        const found = new Set((call.choice ?? "").split(",").filter((entry) => entry !== ""));
        const points =
          row.expected.filter((aliases) => aliases.some((alias) => found.has(registrable(alias)))).length /
          row.expected.length;
        return { points, uncertain: false, key: points.toFixed(2) };
      };
      const jaccard = (a: Set<string>, b: Set<string>): number => {
        const union = new Set([...a, ...b]).size;
        return union === 0 ? 1 : [...a].filter((x) => b.has(x)).length / union;
      };
      const overlaps: number[] = [];
      const per = arm.samples + 20 * 2 * arm.samples;
      const report = await runEval(`hillclimb_${arm.id}`, rows, ask, score, per);
      console.log(formatReport(report));
      for (const runs of shown.values())
        for (let i = 0; i < runs.length; i++)
          for (let j = i + 1; j < runs.length; j++) overlaps.push(jaccard(runs[i]!, runs[j]!));
      const stability = overlaps.reduce((sum, v) => sum + v, 0) / Math.max(overlaps.length, 1);
      console.log(
        `ARM ${arm.id} stability=${stability.toFixed(3)} wall_mean=${String(Math.round(walls.reduce((a, v) => a + v, 0) / Math.max(walls.length, 1)))} wall_p90=${String([...walls].sort((a, b) => a - b)[Math.floor(walls.length * 0.9)] ?? 0)} proposer_calls=${String(calls)} timeouts=${String(timeouts)} mean_ms=${String(Math.round(ms / Math.max(calls, 1)))}`,
      );
      for (const row of rows) {
        const seen = new Set((shown.get(row.self.domain) ?? []).flatMap((run) => [...run]));
        const missed = row.expected.filter((aliases) => !aliases.some((alias) => seen.has(registrable(alias))));
        if (missed.length > 0)
          console.log(
            `MISSED ${arm.id} ${row.split} ${row.self.domain} ${String(missed.length)}/${String(row.expected.length)}: ${missed.map((aliases) => aliases[0]).join(", ")}`,
          );
      }
      expect(report.splits.length).toBeGreaterThan(0);
    },
    1_200_000,
  );
});
