import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JevAnswer } from "../../evals/harness";

interface Wire {
  type: string;
  field: string;
  value: (answer: JevAnswer) => number | undefined;
}

beforeEach(() => {
  vi.stubEnv("LITELLM_JEV_KEY", "");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
});

function wire(): Promise<{ NOUL_WIRE: Wire }> {
  vi.resetModules();
  return import("../../evals/harness") as Promise<{ NOUL_WIRE: Wire }>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the /jev route on this box", () => {
  it("asks the boolean type that endpoint accepts", async () => {
    const { NOUL_WIRE } = await wire();

    expect(NOUL_WIRE.type).toBe("boolean");
  });

  it("reads the probability field its answers carry", async () => {
    const { NOUL_WIRE } = await wire();

    expect(NOUL_WIRE.field).toBe("probability");
    expect(NOUL_WIRE.value({ type: "boolean", probability: 0.24 })).toBe(0.24);
  });

  it("keeps the field paired with the type, so a noul-shaped answer is not read", async () => {
    const { NOUL_WIRE } = await wire();

    expect(NOUL_WIRE.value({ type: "boolean", noul: 0.9 })).toBeUndefined();
  });
});

describe("the Workers AI binding path evals.yml runs", () => {
  it("asks noul and reads noul, which is what production sends", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "api-token");

    const { NOUL_WIRE } = await wire();

    expect(NOUL_WIRE.type).toBe("noul");
    expect(NOUL_WIRE.field).toBe("noul");
    expect(NOUL_WIRE.value({ type: "noul", noul: 0.9 })).toBe(0.9);
  });
});
