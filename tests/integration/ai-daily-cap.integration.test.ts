import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiDailyCapError, takeAiCall, takeJevWorkspaceShare } from "../../app/lib/ai/daily-cap.server";

afterEach(() => {
  vi.restoreAllMocks();
});

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
