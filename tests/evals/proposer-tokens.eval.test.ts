import { describe, expect, it } from "vitest";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const WINDOWS = {
  before: { since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z" },
  after: { since: "2026-10-08T00:00:00Z", until: "2026-10-29T00:00:00Z" },
} as const;

const SCHEMA_QUERY = `{
  inference: __type(name:"aiInferenceAdaptiveGroups"){fields{name type{name kind ofType{name kind}}}}
  gateway: __type(name:"aiGatewayRequestsAdaptiveGroups"){fields{name type{name kind ofType{name kind}}}}
  inferenceDims: __type(name:"aiInferenceAdaptiveGroupsDimensions"){fields{name}}
  gatewayDims: __type(name:"aiGatewayRequestsAdaptiveGroupsDimensions"){fields{name}}
}`;

const NEURON_TOTALS = `query($account:String!,$since:Time!,$until:Time!){
  viewer{accounts(filter:{accountTag:$account}){
    aiInferenceAdaptiveGroups(limit:1,filter:{datetime_geq:$since,datetime_leq:$until}){
      sum{totalNeurons}}}}}`;

interface Group {
  sum?: Record<string, unknown>;
  dimensions?: Record<string, unknown>;
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

async function ask(query: string, variables: Record<string, string>): Promise<unknown> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

describe("discovery proposer token use, before and after the nemotron low-effort change (0509#7268)", () => {
  it("reads the account's Workers AI neurons for both windows and prints the dataset shape", async () => {
    expect(TOKEN, "CLOUDFLARE_API_TOKEN").not.toBe("");
    expect(ACCOUNT, "CLOUDFLARE_ACCOUNT_ID").not.toBe("");
    const schema = await ask(SCHEMA_QUERY, {});
    console.log("dataset shape:", JSON.stringify(schema));
    for (const [window, span] of Object.entries(WINDOWS)) {
      const totals = await ask(NEURON_TOTALS, { account: ACCOUNT, since: span.since, until: span.until });
      const errors = graphqlErrors(totals);
      console.log(`${window} ${span.since}..${span.until} errors:`, JSON.stringify(errors));
      const neurons = rowsOf(totals, "aiInferenceAdaptiveGroups").map((row) => numberOrNull(row.sum?.totalNeurons));
      console.log(`${window} neurons:`, JSON.stringify(neurons));
      for (const value of neurons) expect(value).not.toBeNull();
    }
  });
});
