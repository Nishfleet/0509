import { describe, expect, it } from "vitest";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const WINDOWS = {
  before: { since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z" },
  after: { since: "2026-10-08T00:00:00Z", until: "2026-10-29T00:00:00Z" },
} as const;

const NEURON_QUERY = `query($account:String!,$since:Time!,$until:Time!){
  viewer{accounts(filter:{accountTag:$account}){
    aiInferenceAdaptiveGroups(limit:1000,filter:{datetime_geq:$since,datetime_leq:$until}){
      sum{totalNeurons} dimensions{model}}}}}`;

const REQUEST_QUERY = `query($account:String!,$since:Time!,$until:Time!){
  viewer{accounts(filter:{accountTag:$account}){
    aiGatewayRequestsAdaptiveGroups(limit:1000,filter:{datetimeHour_geq:$since,datetimeHour_leq:$until}){
      count dimensions{model,provider,gateway}}}}}`;

interface Group {
  sum?: Record<string, unknown>;
  dimensions?: Record<string, unknown>;
  count?: unknown;
}

function graphqlErrors(body: unknown): readonly unknown[] {
  const errors = (body as { errors?: unknown }).errors;
  return Array.isArray(errors) ? errors : [];
}

function rowsOf(body: unknown, key: string): readonly Group[] {
  const data = body as { data?: { viewer?: { accounts?: Record<string, unknown>[] } } };
  const rows = data.data?.viewer?.accounts?.[0]?.[key];
  expect(Array.isArray(rows), key).toBe(true);
  return Array.isArray(rows) ? (rows as readonly Group[]) : [];
}

async function ask(query: string, since: string, until: string): Promise<unknown> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables: { account: ACCOUNT, since, until } }),
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function valueOf(row: Group, field: "neurons" | "requests"): number | null {
  if (field === "neurons") return numberOrNull(row.sum?.totalNeurons);
  return numberOrNull(row.count);
}

function modelOf(row: Group): string {
  const model = row.dimensions?.model;
  return typeof model === "string" ? model : "unknown";
}

function perModel(rows: readonly Group[], field: "neurons" | "requests"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const value = valueOf(row, field);
    if (value === null) continue;
    const model = modelOf(row);
    out[model] = (out[model] ?? 0) + value;
  }
  return out;
}

function perCall(neurons: Record<string, number>, requests: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [model, spent] of Object.entries(neurons)) {
    const calls = requests[model] ?? 0;
    out[model] = calls > 0 ? (spent / calls).toFixed(1) : "no calls";
  }
  return out;
}

describe("discovery proposer token use, before and after the nemotron low-effort change (0509#7268)", () => {
  it("reads the account's per-model Workers AI neurons and gateway requests for both windows", async () => {
    expect(TOKEN, "CLOUDFLARE_API_TOKEN").not.toBe("");
    expect(ACCOUNT, "CLOUDFLARE_ACCOUNT_ID").not.toBe("");
    for (const [window, span] of Object.entries(WINDOWS)) {
      const neurons = await ask(NEURON_QUERY, span.since, span.until);
      const requests = await ask(REQUEST_QUERY, span.since, span.until);
      expect(graphqlErrors(neurons), "neurons query").toEqual([]);
      expect(graphqlErrors(requests), "requests query").toEqual([]);
      const neuronRows = rowsOf(neurons, "aiInferenceAdaptiveGroups");
      const requestRows = rowsOf(requests, "aiGatewayRequestsAdaptiveGroups");
      const neuronsPerModel = perModel(neuronRows, "neurons");
      const requestsPerModel = perModel(requestRows, "requests");
      console.log(`=== ${window}: ${span.since} .. ${span.until} ===`);
      console.log("neurons per model:", JSON.stringify(neuronsPerModel));
      console.log("requests per model:", JSON.stringify(requestsPerModel));
      console.log("neurons per call:", JSON.stringify(perCall(neuronsPerModel, requestsPerModel)));
      for (const row of neuronRows) expect(valueOf(row, "neurons")).not.toBeNull();
    }
  });
});
