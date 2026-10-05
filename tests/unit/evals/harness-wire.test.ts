import { afterEach, describe, expect, it, vi } from "vitest";

// The harness asks its noul question with one request type and reads one answer field,
// and both come from the endpoint it posts to (0509#7177). The /jev route on this box
// answers 400 for the wrong request type, so a re-spelling costs a broken eval workflow
// that only a manual run catches. These cases lock the pair for both endpoints with no
// live call.

interface Wire {
  type: string;
  field: string;
  value: (answer: { noul?: number; probability?: number }) => number | undefined;
}

function wire(): Promise<{ NOUL_WIRE: Wire }> {
  // The descriptor is read from the harness's module scope, which is evaluated at
  // import time, so each case imports a fresh copy with its own environment.
  vi.resetModules();
  return import("../../evals/harness") as Promise<{ NOUL_WIRE: Wire }>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.stubEnv("LITELLM_JEV_KEY", "");
  Reflect.deleteProperty(process.env, "CLOUDFLARE_ACCOUNT_ID");
  Reflect.deleteProperty(process.env, "CLOUDFLARE_API_TOKEN");
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
