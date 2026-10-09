import { captureException } from "@sentry/cloudflare";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workerEnv = vi.hoisted(() => ({ env: {} as Record<string, string> }));

vi.mock("cloudflare:workers", () => workerEnv);
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

const { AI_SPEND_OFF, AI_SPEND_ON, AI_SPEND_VAR, aiSpendEnabled, AiSpendOffError, refuseWhenAiSpendOff } =
  await import("../../app/lib/ai/spend.server");

const withVar = (value: string | undefined) => {
  if (value === undefined) Reflect.deleteProperty(workerEnv.env, AI_SPEND_VAR);
  else workerEnv.env[AI_SPEND_VAR] = value;
};

beforeEach(() => {
  vi.mocked(captureException).mockClear();
});

describe("the ai spend kill switch", () => {
  it("refuses to spend when the var was never set, so a missing switch fails closed", () => {
    withVar(undefined);

    expect(aiSpendEnabled()).toBe(false);
    expect(() => {
      refuseWhenAiSpendOff();
    }).toThrow(AiSpendOffError);
    expect(() => {
      refuseWhenAiSpendOff();
    }).toThrow(`${AI_SPEND_VAR}=unset`);
  });

  it("refuses to spend when the var is blank", () => {
    withVar("  ");

    expect(aiSpendEnabled()).toBe(false);
    expect(() => {
      refuseWhenAiSpendOff();
    }).toThrow(AiSpendOffError);
  });

  it("spends when the var says on, and raises no alert", () => {
    withVar(AI_SPEND_ON);

    expect(aiSpendEnabled()).toBe(true);
    expect(() => {
      refuseWhenAiSpendOff();
    }).not.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("raises one fingerprinted error-level Sentry event per refusal, so a switch left off is visible", () => {
    withVar(AI_SPEND_OFF);

    const refusal: unknown = (() => {
      try {
        refuseWhenAiSpendOff();
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(refusal).toBeInstanceOf(AiSpendOffError);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(refusal, { level: "error", fingerprint: ["ai-spend-off"] });
  });

  it("refuses to spend when the var says off, and names the var and its one other value", () => {
    withVar(AI_SPEND_OFF);

    expect(aiSpendEnabled()).toBe(false);
    expect(() => {
      refuseWhenAiSpendOff();
    }).toThrow(AiSpendOffError);
    expect(() => {
      refuseWhenAiSpendOff();
    }).toThrow(`${AI_SPEND_VAR}=off`);
    expect(() => {
      refuseWhenAiSpendOff();
    }).toThrow(`"${AI_SPEND_ON}"`);
  });

  it("treats any other value as off, so a mistyped switch stops spend instead of waving it through", () => {
    withVar("OFF");

    expect(aiSpendEnabled()).toBe(false);
  });
});
