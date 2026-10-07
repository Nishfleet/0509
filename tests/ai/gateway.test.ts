import { describe, expect, it, vi } from "vitest";

const workerEnv = vi.hoisted(() => ({ env: {} as Record<string, string> }));

vi.mock("cloudflare:workers", () => workerEnv);

const { AI_GATEWAY_VAR, DEFAULT_AI_GATEWAY_ID, aiGatewayId } = await import("../../app/lib/ai/gateway.server");

const withVar = (value: string | undefined) => {
  if (value === undefined) Reflect.deleteProperty(workerEnv.env, AI_GATEWAY_VAR);
  else workerEnv.env[AI_GATEWAY_VAR] = value;
};

describe("the product ai gateway id", () => {
  it("is the default gateway when nothing is configured, which is what ships today", () => {
    withVar(undefined);

    expect(aiGatewayId()).toBe(DEFAULT_AI_GATEWAY_ID);
  });

  it("is the named gateway once 0509#7079 creates one and the var names it", () => {
    withVar("0509-product");

    expect(aiGatewayId()).toBe("0509-product");
  });

  it("falls back to the default on an empty var, so a cleared value cannot send traffic nowhere", () => {
    withVar("");

    expect(aiGatewayId()).toBe(DEFAULT_AI_GATEWAY_ID);
  });
});
