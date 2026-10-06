import { describe, expect, it, vi } from "vitest";

const workerEnv = vi.hoisted(() => ({ env: {} as Record<string, string> }));

vi.mock("cloudflare:workers", () => workerEnv);

const { AI_SPEND_OFF, AI_SPEND_ON, AI_SPEND_VAR, aiSpendEnabled, AiSpendOffError, refuseWhenAiSpendOff } =
  await import("../../app/lib/ai/spend.server");

const withVar = (value: string | undefined) => {
  if (value === undefined) Reflect.deleteProperty(workerEnv.env, AI_SPEND_VAR);
  else workerEnv.env[AI_SPEND_VAR] = value;
};

describe("the ai spend kill switch", () => {
  it("spends when the var was never set, so deploying the switch changes nothing", () => {
    withVar(undefined);

    expect(aiSpendEnabled()).toBe(true);
    expect(() => refuseWhenAiSpendOff()).not.toThrow();
  });

  it("spends when the var says on", () => {
    withVar(AI_SPEND_ON);

    expect(aiSpendEnabled()).toBe(true);
  });

  it("refuses to spend when the var says off, and names the var and its one other value", () => {
    withVar(AI_SPEND_OFF);

    expect(aiSpendEnabled()).toBe(false);
    expect(() => refuseWhenAiSpendOff()).toThrow(AiSpendOffError);
    expect(() => refuseWhenAiSpendOff()).toThrow(`${AI_SPEND_VAR}=off`);
    expect(() => refuseWhenAiSpendOff()).toThrow(`"${AI_SPEND_ON}"`);
  });

  it("treats any other value as off, so a mistyped switch stops spend instead of waving it through", () => {
    withVar("OFF");

    expect(aiSpendEnabled()).toBe(false);
  });
});
