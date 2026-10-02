import { parse } from "tldts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MAX_TOKENS, MODEL, RESPONSE_SCHEMA, messagesFor } from "../../app/lib/discovery/generators/ai.server";
import {
  formatReport,
  loadCases,
  postWorkersAi,
  runEval,
  workersAiPresent,
  type Ask,
  type EvalRow,
  type Score,
} from "./harness";

vi.mock("../../app/lib/fetch/outbound.server", () => ({
  fetchOutbound: () => Promise.reject(new Error("no network")),
}));
vi.mock("../../app/lib/fetch/robots.server", () => ({ CRAWLER_USER_AGENT: "eval" }));
vi.mock("../../app/lib/jev/client.server", () => ({ GATEWAY_ID: "default" }));

interface ProposerCase extends EvalRow {
  self: { name: string; domain: string; description: string };
  site: { title: string; description: string };
  expected: string[][];
}

function registrable(value: string): string {
  return parse(value).domain ?? value.toLowerCase();
}

const domainsOnly = z.object({ competitors: z.array(z.object({ domain: z.string() })) });

function proposed(result: unknown): string[] {
  const response = (result as { response?: unknown }).response;
  const body: unknown = typeof response === "string" ? JSON.parse(response) : response;
  return domainsOnly.parse(body).competitors.map((entry) => registrable(entry.domain));
}

function askUnion(samples: number): Ask<ProposerCase> {
  return async (row) => {
    const subject = { name: row.self.name, domain: row.self.domain, description: row.self.description };
    const results = await Promise.all(
      Array.from({ length: samples }, () =>
        postWorkersAi(MODEL, {
          messages: messagesFor(subject, row.site),
          response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
          max_tokens: MAX_TOKENS,
        }),
      ),
    );
    const union = [...new Set(results.flatMap(proposed))];
    return { model: MODEL, p: null, choice: union.join(",") };
  };
}

const recall: Score<ProposerCase> = (row, call) => {
  const found = new Set((call.choice ?? "").split(",").map(registrable));
  const hits = row.expected.filter((aliases) => aliases.some((alias) => found.has(registrable(alias))));
  return { points: hits.length / row.expected.length, uncertain: false, key: String(hits.length) };
};

describe.skipIf(!workersAiPresent())("eval: discovery proposer recall against Workers AI", () => {
  it.each([1, 2, 3])("proposer_recall: unions %i proposal samples per run on both splits", async (samples) => {
    const rows = await loadCases<ProposerCase>("proposer_recall", ["self", "site", "expected"]);
    const report = await runEval(`proposer_recall_union_${String(samples)}`, rows, askUnion(samples), recall, samples);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
