import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Harness from "../../evals/harness";

// EVAL_MAX_NEURONS is the per-run ceiling on Workers AI spend (0509#7249). These cases
// run the real harness against a stubbed AI binding, so no neuron is spent.

const run = vi.fn((): Promise<unknown> => Promise.resolve({ response: "{}" }));

vi.mock("wrangler", () => ({
  getPlatformProxy: () => Promise.resolve({ env: { AI: { run } } }),
}));

beforeEach(() => {
  run.mockClear();
  vi.stubEnv("LITELLM_JEV_KEY", "");
  vi.stubEnv("EVAL_SPLIT", "test");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "api-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function harness(): Promise<Pick<typeof Harness, "postWorkersAi" | "runEval">> {
  vi.resetModules();
  return import("../../evals/harness");
}

describe("EVAL_MAX_NEURONS", () => {
  it("refuses the call that would pass the ceiling and never reaches Workers AI for it", async () => {
    vi.stubEnv("EVAL_MAX_NEURONS", "100");
    const { postWorkersAi, runEval } = await harness();
    await runEval(
      "probe",
      [{ id: "a", split: "test", why: "w" }],
      () => Promise.resolve({ model: "m", p: null, choice: "x" }),
      () => ({ points: 1, uncertain: false, key: "k" }),
    );

    await postWorkersAi("@cf/openai/gpt-oss-120b", {});
    await expect(postWorkersAi("@cf/openai/gpt-oss-120b", {})).rejects.toThrow(/neuron ceiling of 100/);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is off when unset", async () => {
    vi.stubEnv("EVAL_MAX_NEURONS", "");
    const { postWorkersAi, runEval } = await harness();
    await runEval(
      "probe",
      [{ id: "a", split: "test", why: "w" }],
      () => Promise.resolve({ model: "m", p: null, choice: "x" }),
      () => ({ points: 1, uncertain: false, key: "k" }),
    );

    for (let index = 0; index < 3; index += 1) await postWorkersAi("@cf/openai/gpt-oss-120b", {});

    expect(run).toHaveBeenCalledTimes(3);
  });
});
