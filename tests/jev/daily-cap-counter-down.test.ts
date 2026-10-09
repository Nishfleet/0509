import { captureException } from "@sentry/cloudflare";
import { describe, expect, it, vi } from "vitest";

const budget = vi.hoisted(() => ({
  get: vi.fn(() => {
    throw new Error("durable object unreachable");
  }),
  idFromName: vi.fn((name: string) => name),
}));

vi.mock("cloudflare:workers", () => ({ env: { BROWSER_BUDGET: budget } }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

import { AiDailyCapError, takeAiCall, takeJevWorkspaceShare } from "../../app/lib/ai/daily-cap.server";

describe("a daily cap whose counter cannot be reached", () => {
  it("refuses every call but reports the outage once a minute", async () => {
    await expect(takeAiCall("jev", 5)).rejects.toThrow(AiDailyCapError);
    await expect(takeAiCall("jev", 5)).rejects.toThrow(AiDailyCapError);
    await expect(takeAiCall("jev", 5)).rejects.toThrow(AiDailyCapError);

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("refuses a workspace share the same way when its counter is unreachable", async () => {
    await expect(takeJevWorkspaceShare("ws-1")).rejects.toThrow(AiDailyCapError);

    expect(captureException).toHaveBeenCalledTimes(2);
  });
});
