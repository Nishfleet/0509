import { describe, expect, it } from "vitest";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const LOGS_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai-gateway/gateways/default/logs?per_page=5&page=1&order_by=created_at&order=desc`;

const WINDOWS = {
  before: { since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z", days: 7 },
  after: { since: "2026-10-08T00:00:00Z", until: "2026-10-29T00:00:00Z", days: 21 },
} as const;

const NEURONS_BY_MODEL = `query($account:String!,$since:Time!,$until:Time!){
  viewer{accounts(filter:{accountTag:$account}){
    aiInferenceAdaptiveGroups(limit:1000,filter:{datetime_geq:$since,datetime_leq:$until}){
      sum{totalNeurons} dimensions{modelId}}}}}`;

const REQUESTS_BY_MODEL = `query($account:String!,$since:Time!,$until:Time!){
  viewer{accounts(filter:{accountTag:$account}){
    aiGatewayRequestsAdaptiveGroups(limit:1000,filter:{datetimeHour_geq:$since,datetimeHour_leq:$until}){
      count dimensions{model,provider,gateway}}}}}`;

interface Row {
  sum?: Record<string, unknown>;
  dimensions?: Record<string, unknown>;
  count?: unknown;
}

function graphqlErrors(body: unknown): readonly unknown[] {
  const errors = (body as { errors?: unknown }).errors;
  return Array.isArray(errors) ? errors : [];
}

function rowsOf(body: unknown, key: string): readonly Row[] {
  const data = body as { data?: { viewer?: { accounts?: Record<string, unknown>[] } } };
  const rows = data.data?.viewer?.accounts?.[0]?.[key];
  expect(Array.isArray(rows), key).toBe(true);
  return Array.isArray(rows) ? (rows as readonly Row[]) : [];
}

async function ask(query: string, since: string, until: string): Promise<unknown> {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("authorization", `Bearer ${TOKEN}`);
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables: { account: ACCOUNT, since, until } }),
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function neuronsByModel(body: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rowsOf(body, "aiInferenceAdaptiveGroups")) {
    const spent = numberOrNull(row.sum?.totalNeurons);
    const model = row.dimensions?.modelId;
    if (spent === null || typeof model !== "string") continue;
    out.set(model, (out.get(model) ?? 0) + spent);
  }
  return out;
}

function requestsByModel(body: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rowsOf(body, "aiGatewayRequestsAdaptiveGroups")) {
    const calls = numberOrNull(row.count);
    const model = row.dimensions?.model;
    if (calls === null || typeof model !== "string") continue;
    out.set(model, (out.get(model) ?? 0) + calls);
  }
  return out;
}

describe("discovery proposer token use, before and after the nemotron low-effort change (0509#7268)", () => {
  it("reads the account's per-model Workers AI neurons and gateway requests for both windows", async () => {
    expect(TOKEN, "CLOUDFLARE_API_TOKEN").not.toBe("");
    expect(ACCOUNT, "CLOUDFLARE_ACCOUNT_ID").not.toBe("");
    for (const [window, span] of Object.entries(WINDOWS)) {
      const neurons = await ask(NEURONS_BY_MODEL, span.since, span.until);
      const requests = await ask(REQUESTS_BY_MODEL, span.since, span.until);
      expect(graphqlErrors(neurons), "neurons query").toEqual([]);
      expect(graphqlErrors(requests), "requests query").toEqual([]);
      const spent = neuronsByModel(neurons);
      const calls = requestsByModel(requests);
      const perModel = [...spent]
        .map(([model, total]) => ({
          model,
          neurons: round(total),
          neuronsPerDay: round(total / span.days),
          calls: calls.get(model) ?? 0,
          neuronsPerCall: round(total / (calls.get(model) ?? Number.NaN)),
        }))
        .sort((left, right) => right.neurons - left.neurons);
      console.log(`=== ${window}: ${span.since} .. ${span.until} (${span.days} days) ===`);
      console.log(JSON.stringify(perModel));
      for (const row of perModel) expect(row.neurons).toBeGreaterThan(0);
    }
    const logs = await fetch(LOGS_URL, {
      headers: new Headers({ authorization: `Bearer ${TOKEN}` }),
      signal: AbortSignal.timeout(30_000),
    });
    console.log("gateway request logs status:", logs.status);
  });
});
