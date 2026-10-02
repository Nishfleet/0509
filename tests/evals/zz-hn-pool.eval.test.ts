import { parse } from "tldts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { hnGenerator } from "../../app/lib/discovery/generators/hn.server";
import {
  MAX_TOKENS,
  MODEL,
  RESPONSE_FORMAT,
  messagesFor,
  proposalBody,
} from "../../app/lib/discovery/generators/ai.server";
import { loadCases, postWorkersAi, setCallBudget, workersAiPresent, type EvalRow } from "./harness";

vi.mock("../../app/lib/fetch/outbound.server", () => ({
  fetchOutbound: () => Promise.reject(new Error("no network")),
}));
vi.mock("../../app/lib/fetch/robots.server", () => ({ CRAWLER_USER_AGENT: "eval" }));
vi.mock("../../app/lib/jev/client.server", () => ({ GATEWAY_ID: "default" }));

interface Row extends EvalRow {
  self: { name: string; domain: string; description: string };
  site: { title: string; description: string };
  expected: string[][];
}

const registrable = (value: string): string => parse(value).domain ?? value.toLowerCase();
const label = (value: string): string => registrable(value).split(".")[0] ?? "";
const flat = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const proposals = z.object({ competitors: z.array(z.object({ name: z.string(), domain: z.string() })) });

describe.skipIf(!workersAiPresent())("hn pool: co-mention recall before judging", () => {
  it("measures candidate-pool recall of the HN co-mention source, alone and on top of the proposer", async () => {
    setCallBudget(500);
    const rows = await loadCases<Row>("proposer_recall", ["self", "site", "expected"]);
    const totals = { train: { n: 0, ai: 0, hn: 0, both: 0, pool: 0 }, test: { n: 0, ai: 0, hn: 0, both: 0, pool: 0 } };
    for (const row of rows) {
      const subject = { name: row.self.name, domain: row.self.domain, description: row.self.description };
      let hnNames: string[] = [];
      try {
        const found = await hnGenerator(subject, async (url) => {
          const response = await fetch(url);
          return {
            ok: response.ok,
            status: response.status,
            url,
            contentType: "application/json",
            body: await response.text(),
          };
        });
        hnNames = found.map((candidate) => flat(candidate.name));
      } catch (error) {
        console.log(`HNPOOL ${row.self.domain} hn failed ${String(error).slice(0, 120)}`);
      }
      let aiDomains = new Set<string>();
      try {
        const result = await postWorkersAi(MODEL, {
          messages: messagesFor(subject, row.site),
          response_format: RESPONSE_FORMAT,
          max_tokens: MAX_TOKENS,
        });
        const parsed = proposals.safeParse(proposalBody(result));
        aiDomains = new Set(parsed.success ? parsed.data.competitors.map((entry) => registrable(entry.domain)) : []);
      } catch (error) {
        console.log(`HNPOOL ${row.self.domain} ai failed ${String(error).slice(0, 120)}`);
      }
      const bucket = totals[row.split];
      const viaAi = row.expected.filter((aliases) => aliases.some((alias) => aiDomains.has(registrable(alias))));
      const viaHn = row.expected.filter((aliases) => aliases.some((alias) => hnNames.includes(flat(label(alias)))));
      const both = row.expected.filter((aliases) => viaAi.includes(aliases) || viaHn.includes(aliases));
      bucket.n += row.expected.length;
      bucket.ai += viaAi.length;
      bucket.hn += viaHn.length;
      bucket.both += both.length;
      bucket.pool += hnNames.length;
      const added = viaHn.filter((aliases) => !viaAi.includes(aliases)).map((aliases) => aliases[0]);
      console.log(
        `HNPOOL ${row.split} ${row.self.domain} hn_names=${String(hnNames.length)} ai=${String(viaAi.length)} hn=${String(viaHn.length)} of ${String(row.expected.length)}; hn adds: ${added.join(", ") || "-"}`,
      );
    }
    for (const split of ["train", "test"] as const) {
      const t = totals[split];
      console.log(
        `HNPOOL TOTAL ${split} expected=${String(t.n)} ai_recall=${(t.ai / t.n).toFixed(3)} hn_recall=${(t.hn / t.n).toFixed(3)} union_recall=${(t.both / t.n).toFixed(3)} mean_hn_pool=${(t.pool / 25).toFixed(0)}`,
      );
    }
    expect(totals.train.n).toBeGreaterThan(0);
  }, 1_200_000);
});
