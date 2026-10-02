import { describe, expect, it, vi } from "vitest";

import { messagesFor, RESPONSE_FORMAT, MAX_TOKENS, proposalBody } from "../../app/lib/discovery/generators/ai.server";
import { IS_COMPETITOR, SAME_CATEGORY } from "../../app/lib/discovery/run.server";
import { loadCases, makeNoulsAsk, postWorkersAi, setCallBudget, workersAiPresent, type EvalRow } from "./harness";

vi.mock("../../app/lib/fetch/outbound.server", () => ({ fetchOutbound: fetch }));
vi.mock("../../app/lib/fetch/robots.server", () => ({ CRAWLER_USER_AGENT: "eval" }));
vi.mock("../../app/lib/jev/client.server", () => ({ GATEWAY_ID: "default" }));

interface Case extends EvalRow {
  self: { name: string; domain: string; description: string };
  site: { title: string; description: string };
}

const GPT = "@cf/openai/gpt-oss-120b";
const NEMO = "@cf/nvidia/nemotron-3-120b-a12b";
const BRANDS = ["allbirds", "notion", "figma", "calendly"];

async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; value: T | null }> {
  const start = performance.now();
  try {
    return { ms: Math.round(performance.now() - start + 0 * 0), value: await run() };
  } catch {
    return { ms: Math.round(performance.now() - start), value: null };
  }
}

async function wall<T>(run: () => Promise<T>): Promise<{ ms: number; value: T | null }> {
  const start = performance.now();
  let value: T | null = null;
  try {
    value = await run();
  } catch {
    value = null;
  }
  return { ms: Math.round(performance.now() - start), value };
}

function domainsOf(raw: unknown): string[] {
  const body = proposalBody(raw) as { competitors?: { domain: string }[] } | null;
  return (body?.competitors ?? []).map((entry) => entry.domain);
}

describe.skipIf(!workersAiPresent())("speed probe", () => {
  it("times each stage of discovery", async () => {
    setCallBudget(400);
    const rows = (await loadCases<Case>("proposer_recall", ["self", "site", "expected"])).filter((row) =>
      BRANDS.some((brand) => row.id.includes(brand)),
    );
    const lines: string[] = ["brand | site | gpt-oss | nemotron | both | live HEADs | HN | wikidata x6 | judge 1 | judge 10 parallel"];
    for (const row of rows) {
      const subject = { name: row.self.name, domain: row.self.domain, description: row.self.description };
      const messages = messagesFor(subject, row.site);
      const body = { messages, response_format: RESPONSE_FORMAT, max_tokens: MAX_TOKENS };
      const site = await wall(() => fetch(`https://${row.self.domain}/`, { signal: AbortSignal.timeout(10_000) }));
      const gpt = await wall(() => postWorkersAi(GPT, body));
      const nemo = await wall(() => postWorkersAi(NEMO, body));
      const both = await wall(() => Promise.all([postWorkersAi(GPT, body), postWorkersAi(NEMO, body)]));
      const domains = [...new Set([...domainsOf(gpt.value), ...domainsOf(nemo.value)])];
      const live = await wall(() =>
        Promise.all(
          domains.map((domain) =>
            fetch(`https://${domain}/`, { method: "HEAD", signal: AbortSignal.timeout(8_000) }).catch(() => null),
          ),
        ),
      );
      const hn = await wall(() =>
        fetch(
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(row.self.name)}&tags=(story,comment)&hitsPerPage=100`,
        ).then((response) => response.text()),
      );
      const names = ["Hoka", "Vans", "On Running", "Canva", "Penpot", "Zoom"];
      const wiki = await wall(() =>
        Promise.all(
          names.map(async (name) => {
            const search = await fetch(
              `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=1`,
            ).then((response) => response.json() as Promise<{ search: { id: string }[] }>);
            const id = search.search[0]?.id;
            if (id !== undefined) {
              await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`).then((response) => response.text());
            }
          }),
        ),
      );
      const ask = makeNoulsAsk([IS_COMPETITOR, SAME_CATEGORY], (ps) => Math.min(...ps));
      const state = (candidate: string) => ({
        self: subject,
        competitor_set: [],
        item: { name: candidate, domain: `${candidate.toLowerCase()}.com`, evidence: [{ source: "x", excerpt: `${candidate} sells something similar` }] },
        user_memory: { dismissed_domains: [] },
        reliability: { hn: "best_effort" },
      });
      const one = await wall(() => ask(state("Hoka")));
      const ten = await wall(() => Promise.all(["Hoka", "Vans", "On", "Nike", "Brooks", "Saucony", "Keen", "Toms", "Veja", "Cariuma"].map((name) => ask(state(name)))));
      void timed;
      lines.push(
        [row.id, site.ms, gpt.ms, nemo.ms, both.ms, `${live.ms} (${String(domains.length)})`, hn.ms, wiki.ms, one.ms, ten.ms].join(" | "),
      );
    }
    console.log(`SPEED PROBE (ms)\n${lines.join("\n")}`);
    expect(lines.length).toBeGreaterThan(1);
  }, 1_800_000);
});
