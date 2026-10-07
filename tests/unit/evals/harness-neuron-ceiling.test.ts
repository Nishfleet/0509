import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Harness from "../../evals/harness";

// EVAL_MAX_NEURONS is the per-run ceiling on Workers AI spend and EVAL_DAILY_NEURON_CEILING
// the per-day one (0509#7249). These cases run the real harness against a stubbed AI binding
// and a stubbed GraphQL endpoint, so no neuron is spent.

const run = vi.fn((): Promise<unknown> => Promise.resolve({ response: "{}" }));

vi.mock("wrangler", () => ({
  getPlatformProxy: () => Promise.resolve({ env: { AI: { run } } }),
}));

function reply(neurons: number): Response {
  const body = {
    data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [{ sum: { totalNeurons: neurons } }] }] } },
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

const graphql = vi.fn((): Promise<Response> => Promise.resolve(reply(1000)));

beforeEach(() => {
  run.mockClear();
  graphql.mockReset();
  graphql.mockImplementation(() => Promise.resolve(reply(1000)));
  vi.stubGlobal("fetch", graphql);
  vi.stubEnv("LITELLM_JEV_KEY", "");
  vi.stubEnv("EVAL_SPLIT", "test");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "api-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const MODEL = "@cf/openai/gpt-oss-120b";

async function started(): Promise<Pick<typeof Harness, "postWorkersAi">> {
  vi.resetModules();
  const { postWorkersAi, runEval } = await import("../../evals/harness");
  await runEval(
    "probe",
    [{ id: "a", split: "test", why: "w" }],
    () => Promise.resolve({ model: "m", p: null, choice: "x" }),
    () => ({ points: 1, uncertain: false, key: "k" }),
  );
  return { postWorkersAi };
}

describe("EVAL_MAX_NEURONS", () => {
  it("refuses the call that would pass the ceiling and never reaches Workers AI for it", async () => {
    vi.stubEnv("EVAL_MAX_NEURONS", "100");
    const { postWorkersAi } = await started();

    await postWorkersAi(MODEL, {});
    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/neuron ceiling of 100/);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is off when unset", async () => {
    vi.stubEnv("EVAL_MAX_NEURONS", "");
    const { postWorkersAi } = await started();

    for (let index = 0; index < 3; index += 1) await postWorkersAi(MODEL, {});

    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe("EVAL_DAILY_NEURON_CEILING", () => {
  beforeEach(() => {
    vi.stubEnv("EVAL_MAX_NEURONS", "2000");
    vi.stubEnv("EVAL_DAILY_NEURON_CEILING", "9000");
  });

  it("goes ahead when today's neurons plus the run ceiling fit, asking GraphQL once", async () => {
    graphql.mockImplementation(() => Promise.resolve(reply(7000)));
    const { postWorkersAi } = await started();

    await postWorkersAi(MODEL, {});
    await postWorkersAi(MODEL, {});

    expect(run).toHaveBeenCalledTimes(2);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("stops before any call when today's neurons plus the run ceiling pass the daily ceiling", async () => {
    graphql.mockImplementation(() => Promise.resolve(reply(7001)));
    const { postWorkersAi } = await started();

    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/daily ceiling of 9000/);

    expect(run).not.toHaveBeenCalled();
  });

  it("stops before any call when GraphQL answers an error status", async () => {
    graphql.mockImplementation(() => Promise.resolve(new Response("no", { status: 403 })));
    const { postWorkersAi } = await started();

    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/cannot read today's neurons/);

    expect(run).not.toHaveBeenCalled();
  });

  it("stops before any call when GraphQL is unreachable", async () => {
    graphql.mockImplementation(() => Promise.reject(new Error("offline")));
    const { postWorkersAi } = await started();

    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/cannot read today's neurons/);

    expect(run).not.toHaveBeenCalled();
  });

  it("stops before any call when GraphQL returns errors", async () => {
    graphql.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ errors: [{ message: "denied" }] }), { status: 200 })),
    );
    const { postWorkersAi } = await started();

    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/cannot read today's neurons/);

    expect(run).not.toHaveBeenCalled();
  });
});
