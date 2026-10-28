import { describe, expect, it } from "vitest";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const LOGS_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai-gateway/gateways/default/logs?per_page=5&page=1&order_by=created_at&order=desc`;

const WINDOWS = {
  before: { since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z" },
  after: { since: "2026-10-08T00:00:00Z", until: "2026-10-29T00:00:00Z" },
} as const;

const accountFilter = "viewer{accounts(filter:{accountTag:$account}){";
const windowFilter = "filter:{datetime_geq:$since,datetime_leq:$until}";
const hourFilter = "filter:{datetimeHour_geq:$since,datetimeHour_leq:$until}";

const QUERIES: Record<string, string> = {
  gatewayPerModel: `query($account:String!,$since:Time!,$until:Time!){${accountFilter}aiGatewayRequestsAdaptiveGroups(limit:1000,${hourFilter}){count dimensions{model,provider,gateway}}}}}`,
  gatewayPerModelByDate: `query($account:String!,$since:Time!,$until:Time!){${accountFilter}aiGatewayRequestsAdaptiveGroups(limit:1000,${windowFilter}){count dimensions{model,provider,gateway}}}}}`,
  inferenceModelId: `query($account:String!,$since:Time!,$until:Time!){${accountFilter}aiInferenceAdaptiveGroups(limit:1000,${windowFilter}){sum{totalNeurons} dimensions{modelId}}}}}`,
  inferenceAiModel: `query($account:String!,$since:Time!,$until:Time!){${accountFilter}aiInferenceAdaptiveGroups(limit:1000,${windowFilter}){sum{totalNeurons} dimensions{aiModel}}}}}`,
  inferenceTs: `query($account:String!,$since:Time!,$until:Time!){${accountFilter}aiInferenceAdaptiveGroups(limit:1000,${windowFilter}){sum{totalNeurons} dimensions{ts}}}}}`,
  inferenceSums: `query($account:String!,$since:Time!,$until:Time!){${accountFilter}aiInferenceAdaptiveGroups(limit:1,${windowFilter}){sum{totalNeurons totalTokens cost}}}}}`,
};

async function send(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...init?.headers },
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

describe("discovery proposer token use, before and after the nemotron low-effort change (0509#7268)", () => {
  it("finds the per-model field names the Workers AI analytics schema accepts", async () => {
    expect(TOKEN, "CLOUDFLARE_API_TOKEN").not.toBe("");
    expect(ACCOUNT, "CLOUDFLARE_ACCOUNT_ID").not.toBe("");
    for (const [name, query] of Object.entries(QUERIES)) {
      const body = await send(GRAPHQL_URL, {
        method: "POST",
        body: JSON.stringify({ query, variables: { account: ACCOUNT, ...WINDOWS.after } }),
      });
      console.log(`--- ${name} ---`, JSON.stringify(body).slice(0, 2500));
    }
    console.log("--- gateway logs ---", JSON.stringify(await send(LOGS_URL)).slice(0, 2500));
  });
});
