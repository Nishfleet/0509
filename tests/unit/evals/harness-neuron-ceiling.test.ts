import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Harness from "../../evals/harness";

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

async function started(startupCeiling: string): Promise<Pick<typeof Harness, "postWorkersAi" | "runEval">> {
  vi.resetModules();
  vi.stubEnv("EVAL_MAX_NEURONS", startupCeiling);
  const { postWorkersAi, runEval } = await import("../../evals/harness");
  await runEval(
    "probe",
    [{ id: "a", split: "test", why: "w" }],
    () => Promise.resolve({ model: "m", p: null, choice: "x" }),
    () => ({ points: 1, uncertain: false, key: "k" }),
  );
  return { postWorkersAi, runEval };
}

describe("EVAL_MAX_NEURONS", () => {
  it("refuses the call that would pass the ceiling and never reaches Workers AI for it", async () => {
    const { postWorkersAi } = await started("100");

    await postWorkersAi(MODEL, {});
    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/neuron ceiling of 100/);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is off when unset", async () => {
    const { postWorkersAi } = await started("");

    for (let index = 0; index < 3; index += 1) await postWorkersAi(MODEL, {});

    expect(run).toHaveBeenCalledTimes(3);
  });
});

async function ceilingOnly(value: string): Promise<typeof Harness.runEval> {
  vi.resetModules();
  vi.stubEnv("EVAL_MAX_NEURONS", value);
  return (await import("../../evals/harness")).runEval;
}

describe("EVAL_MAX_NEURONS as the repository variable of 0509#10054", () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    id: `row-${String(index)}`,
    split: "test" as const,
    why: "w",
  }));
  const asked = () => Promise.resolve({ model: "m", p: null, choice: "x" });
  const scored = () => ({ points: 1, uncertain: false, key: "k" });

  it("refuses the 60-row same_category plan at the reviewed default of 2000", async () => {
    const runEval = await ceilingOnly("2000");

    await expect(runEval("same_category", rows, asked, scored)).rejects.toThrow(
      /needs about 3060 neurons \(60 rows x 3 repeats x 17 per call\).*over the ceiling of 2000/,
    );
  });

  it("admits the same plan once the variable is above 3060, before any Workers AI call", async () => {
    const runEval = await ceilingOnly("3400");

    const report = await runEval("same_category", rows, asked, scored);

    expect(report.neuronCeiling).toBe(3400);
    expect(report.splits.map((split) => split.cases)).toEqual([60]);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a value that is not a positive integer instead of turning the ceiling off", async () => {
    await expect(ceilingOnly("4,000")).rejects.toThrow(
      /EVAL_MAX_NEURONS must be a positive integer or empty, got 4,000/,
    );
  });
});

describe("runEval ceiling fit", () => {
  const scored = () => ({ points: 1, uncertain: false, key: "k" });
  const asked = () => Promise.resolve({ model: "m", p: null, choice: "x" });

  it("refuses a run whose call budget cannot fit before any paid call", async () => {
    const { runEval } = await started("100");
    const rows = Array.from({ length: 4 }, (_, index) => ({
      id: `row-${String(index)}`,
      split: "test" as const,
      why: "w",
    }));

    await expect(runEval("probe", rows, asked, scored)).rejects.toThrow(/refused before any paid call/);

    expect(run).not.toHaveBeenCalled();
    expect(graphql).not.toHaveBeenCalled();
  });

  it("counts neurons already spent in the same process", async () => {
    const { postWorkersAi, runEval } = await started("250");
    await postWorkersAi(MODEL, {});
    await postWorkersAi(MODEL, {});
    const rows = [{ id: "a", split: "test" as const, why: "w" }];

    await expect(runEval("probe", rows, asked, scored, 60)).rejects.toThrow(/refused before any paid call/);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("lets a run through whose exact plan fits although the padded call budget does not", async () => {
    const { runEval } = await started("230");
    const rows = Array.from({ length: 4 }, (_, index) => ({
      id: `row-${String(index)}`,
      split: "test" as const,
      why: "w",
    }));

    const report = await runEval("probe", rows, asked, scored);

    expect(report.questionId).toBe("probe");
    expect(report.neuronCeiling).toBe(230);
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores a row whose split the run does not select", async () => {
    const { runEval } = await started("100");
    const rows = [
      { id: "t", split: "test" as const, why: "w" },
      { id: "r", split: "train" as const, why: "w" },
    ];

    const report = await runEval("probe", rows, asked, scored);

    expect(report.questionId).toBe("probe");
    expect(report.splits.map((split) => split.split)).toEqual(["test"]);
    expect(run).not.toHaveBeenCalled();
  });

  it("counts the rows of every selected split in the plan", async () => {
    const { runEval } = await started("100");
    vi.stubEnv("EVAL_SPLIT", "all");
    const rows = [
      { id: "t", split: "test" as const, why: "w" },
      { id: "r", split: "train" as const, why: "w" },
    ];

    await expect(runEval("probe", rows, asked, scored)).rejects.toThrow(/refused before any paid call/);

    expect(run).not.toHaveBeenCalled();
  });

  it("lets a run go ahead when its call budget fits the ceiling", async () => {
    const { runEval } = await started("100");
    const rows = [{ id: "a", split: "test" as const, why: "w" }];

    const report = await runEval("probe", rows, asked, scored);

    expect(report.neuronCeiling).toBe(100);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("EVAL_DAILY_NEURON_CEILING", () => {
  beforeEach(() => {
    vi.stubEnv("EVAL_MAX_NEURONS", "2000");
    vi.stubEnv("EVAL_DAILY_NEURON_CEILING", "9000");
  });

  it("goes ahead when today's neurons plus the run ceiling fit, asking GraphQL once", async () => {
    graphql.mockImplementation(() => Promise.resolve(reply(7000)));
    const { postWorkersAi } = await started("2000");

    await postWorkersAi(MODEL, {});
    await postWorkersAi(MODEL, {});

    expect(run).toHaveBeenCalledTimes(2);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("stops before any call when today's neurons plus the run ceiling pass the daily ceiling", async () => {
    graphql.mockImplementation(() => Promise.resolve(reply(7001)));
    const { postWorkersAi } = await started("2000");

    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/daily ceiling of 9000/);

    expect(run).not.toHaveBeenCalled();
  });

  it("stops before any call when GraphQL answers an error status", async () => {
    graphql.mockImplementation(() => Promise.resolve(new Response("no", { status: 403 })));
    const { postWorkersAi } = await started("2000");

    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/cannot read today's neurons/);

    expect(run).not.toHaveBeenCalled();
  });

  it("stops before any call when GraphQL is unreachable", async () => {
    graphql.mockImplementation(() => Promise.reject(new Error("offline")));
    const { postWorkersAi } = await started("2000");

    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/cannot read today's neurons/);

    expect(run).not.toHaveBeenCalled();
  });

  it("stops before any call when GraphQL returns errors", async () => {
    graphql.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ errors: [{ message: "denied" }] }), { status: 200 })),
    );
    const { postWorkersAi } = await started("2000");

    await expect(postWorkersAi(MODEL, {})).rejects.toThrow(/cannot read today's neurons/);

    expect(run).not.toHaveBeenCalled();
  });
});
