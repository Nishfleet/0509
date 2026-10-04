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

const MAX_JUDGED = 10;
const GAP_MS = 2_400;

const registrable = (value: string): string => parse(value).domain ?? value.toLowerCase();
const proposals = z.object({ competitors: z.array(z.object({ name: z.string(), domain: z.string() })) });

let nextSlot = 0;
async function paced<T>(call: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP_MS;
  await new Promise((resolve) => setTimeout(resolve, at - now));
  return call();
}

interface Pooled {
  name: string;
  domain: string;
  home: string;
}

function homeText(html: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  const meta = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? "";
  return `${title.trim()} ${meta.trim()}`.replace(/\s+/g, " ").slice(0, 300);
}

async function homeOf(domain: string): Promise<string> {
  try {
    const response = await fetch(`https://${domain}/`, { signal: AbortSignal.timeout(5_000) });
    return homeText((await response.text()).slice(0, 200_000));
  } catch {
    return "";
  }
}

const pools = new Map<string, Pooled[]>();

async function poolFor(row: Row): Promise<Pooled[]> {
  const known = pools.get(row.self.domain);
  if (known !== undefined) return known;
  const result = await paced(() =>
    postWorkersAi(MODEL, {
      messages: messagesFor(
        { name: row.self.name, domain: row.self.domain, description: row.self.description },
        row.site,
      ),
      response_format: RESPONSE_FORMAT,
      max_tokens: MAX_TOKENS,
    }),
  );
  const parsed = proposals.safeParse(proposalBody(result));
  const own = registrable(row.self.domain);
  const seen = new Set<string>([own]);
  const items = (parsed.success ? parsed.data.competitors : []).filter((item) => {
    const domain = registrable(item.domain);
    if (seen.has(domain)) return false;
    seen.add(domain);
    return true;
  });
  const pooled = await Promise.all(
    items.slice(0, MAX_JUDGED).map(async (item) => ({
      name: item.name,
      domain: registrable(item.domain),
      home: await homeOf(registrable(item.domain)),
    })),
  );
  pools.set(row.self.domain, pooled);
  return pooled;
}

function keeps(row: Row, item: Pooled, withHome: boolean): Promise<boolean> {
  const excerpt = "Proposed by a language model reading the brand's own site; not corroborated by any other source";
  const state = {
    self: { name: row.self.name, domain: row.self.domain, description: row.self.description },
    competitor_set: [],
    item: {
      name: item.name,
      domain: item.domain,
      evidence: [
        { source: row.self.domain, excerpt },
        ...(withHome && item.home !== ""
          ? [{ source: `https://${item.domain}/`, excerpt: `Its homepage says: ${item.home}` }]
          : []),
      ],
    },
    user_memory: { dismissed_domains: [] },
    reliability: { hn: "best_effort" },
  };
  const combine = (ps: number[]): number =>
    keepOnlyIfBoth(ps.map((p) => ({ questionId: "", inputHash: "", p, cached: false }))).p;
  return paced(() => makeNoulsAsk([IS_COMPETITOR, SAME_CATEGORY], combine)(state)).then(
    (call) => (call.p ?? 0) > REJECT_AT,
  );
}

const ARMS = [
  { id: "judge_today", withHome: false },
  { id: "judge_with_homepage", withHome: true },
];

describe.skipIf(!workersAiPresent())("homepage evidence for the judge", () => {
  it("both arms judge the same pool, one after the other", async () => {
    const rows = await loadCases<Row>("proposer_recall", ["self", "site", "expected"]);
    for (const arm of ARMS) {
      const ask: Ask<Row> = async (row) => {
        const pooled = await poolFor(row);
        const kept: string[] = [];
        for (const item of pooled) if (await keeps(row, item, arm.withHome)) kept.push(item.domain);
        console.log(
          `KEPT ${arm.id} ${row.self.domain}: ${kept.join(",")} POOL ${pooled.map((p) => p.domain).join(",")}`,
        );
        return { model: MODEL, p: null, choice: kept.join(",") };
      };
      const score: Score<Row> = (row, call) => {
        const found = new Set((call.choice ?? "").split(",").filter((entry) => entry !== ""));
        const points =
          row.expected.filter((aliases) => aliases.some((alias) => found.has(registrable(alias)))).length /
          row.expected.length;
        return { points, uncertain: false, key: points.toFixed(2) };
      };
      const report = await runEval(`homepage_${arm.id}`, rows, ask, score, 1 + 2 * MAX_JUDGED + 2);
      console.log(formatReport(report));
    }
    expect(pools.size).toBeGreaterThan(0);
  }, 2_100_000);
});
