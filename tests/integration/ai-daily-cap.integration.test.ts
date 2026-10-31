import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiDailyCapError, takeAiCall, takeJevWorkspaceShare } from "../../app/lib/ai/daily-cap.server";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(env, "AI_DAILY_CAP_SCALE");
});

async function firstRefusal(take: () => Promise<void>, attempts: number): Promise<unknown> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await take();
    } catch (error) {
      return error;
    }
  }
  return undefined;
}

function setScale(value: string): void {
  Reflect.set(env, "AI_DAILY_CAP_SCALE", value);
}

describe("takeAiCall", () => {
  it("allows calls up to the limit, then refuses and logs the line", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await takeAiCall("proposer", 2);
    await takeAiCall("proposer", 2);

    await expect(takeAiCall("proposer", 2)).rejects.toThrow(AiDailyCapError);
    await expect(takeAiCall("proposer", 2)).rejects.toThrow(AiDailyCapError);
    const alerts = logged.mock.calls.filter(([entry]) => String(entry).includes('"event":"ai.daily_cap_reached"'));
    expect(alerts).toHaveLength(1);
  });

  it("counts each line on its own", async () => {
    await takeAiCall("jev", 1);

    await expect(takeAiCall("jev", 1)).rejects.toThrow(AiDailyCapError);
    await expect(takeAiCall("proposer", 5)).resolves.toBeUndefined();
  });

  it("keeps one workspace's share apart from the others", async () => {
    await takeJevWorkspaceShare("heavy", 2);
    await takeJevWorkspaceShare("heavy", 2);

    await expect(takeJevWorkspaceShare("heavy", 2)).rejects.toThrow(AiDailyCapError);
    await expect(takeJevWorkspaceShare("quiet", 2)).resolves.toBeUndefined();
  });

  it("refuses the call when the counter cannot be reached", async () => {
    vi.spyOn(env.BROWSER_BUDGET, "get").mockImplementation(() => {
      throw new Error("durable object unreachable");
    });

    await expect(takeAiCall("jev", 5)).rejects.toThrow(AiDailyCapError);
  });
});

describe("AI_DAILY_CAP_SCALE", () => {
  it("keeps the limit as given when the variable is unset or blank", async () => {
    for (const blank of [undefined, "", "   "]) {
      Reflect.deleteProperty(env, "AI_DAILY_CAP_SCALE");
      if (blank !== undefined) setScale(blank);
      const workspace = `unscaled-${JSON.stringify(blank)}`;
      await takeJevWorkspaceShare(workspace, 2);
      await takeJevWorkspaceShare(workspace, 2);
      await expect(takeJevWorkspaceShare(workspace, 2)).rejects.toThrow(AiDailyCapError);
    }
  });

  it("lowers a workspace share to the fraction of its limit", async () => {
    setScale("0.25");
    await takeJevWorkspaceShare("quarter", 8);
    await takeJevWorkspaceShare("quarter", 8);

    await expect(takeJevWorkspaceShare("quarter", 8)).rejects.toThrow(AiDailyCapError);
  });

  it("lowers the whole-day line to the fraction of its limit", async () => {
    setScale("0.5");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const refusal = await firstRefusal(() => takeAiCall("proposer", 6), 6);

    expect(refusal).toBeInstanceOf(AiDailyCapError);
    expect(String(refusal)).toContain("of 3 calls is used");
  });

  it("never rounds a positive fraction down to zero calls", async () => {
    setScale("0.0001");
    await takeJevWorkspaceShare("floor", 10);

    await expect(takeJevWorkspaceShare("floor", 10)).rejects.toThrow(AiDailyCapError);
  });

  it("treats 1 as the full limit", async () => {
    setScale("1");
    await takeJevWorkspaceShare("full", 2);
    await takeJevWorkspaceShare("full", 2);

    await expect(takeJevWorkspaceShare("full", 2)).rejects.toThrow(AiDailyCapError);
  });

  it.each(["abc", "0", "-1", "1.5", "NaN", "Infinity"])(
    "refuses every call when the value %j is not a fraction",
    async (value) => {
      setScale(value);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await expect(takeJevWorkspaceShare(`bad-${value}`, 2)).rejects.toThrow(AiDailyCapError);
      await expect(takeAiCall("proposer", 5)).rejects.toThrow(AiDailyCapError);
    },
  );
});
