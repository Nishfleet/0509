import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ run: vi.fn() }));
const caps = vi.hoisted(() => ({ share: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: { AI: ai, AI_SPEND: "on" } }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
vi.mock("../../app/lib/data/jev_verdict.server", () => ({
  readCachedNoul: () => Promise.resolve(null),
  readCachedChoice: () => Promise.resolve(null),
}));
vi.mock("../../app/lib/data/jev_failure.server", () => ({ insertJevFailure: () => Promise.resolve() }));
vi.mock("../../app/lib/ai/daily-cap.server", () => ({
  JEV_CALLS_PER_DAY: 1,
  takeAiCall: () => Promise.reject(new Error("the daily jev allowance of 1 calls is used")),
  takeJevWorkspaceShare: caps.share,
}));

import { askNoul, JevUnavailableError, type NoulQuestion } from "../../app/lib/jev/client.server";

const QUESTION: NoulQuestion = { id: "q", instructions: "i", whenTrue: "t", whenFalse: "f" };

beforeEach(() => {
  ai.run.mockReset();
  caps.share.mockReset();
  caps.share.mockResolvedValue(undefined);
});

describe("a Jev call past the daily cap", () => {
  it("never reaches Workers AI and reads as Jev unavailable", async () => {
    await expect(askNoul("ws-1", QUESTION, {})).rejects.toThrow(JevUnavailableError);

    expect(ai.run).not.toHaveBeenCalled();
  });

  it("refuses a workspace past its own share before the global counter or Workers AI", async () => {
    caps.share.mockRejectedValue(new Error("the daily jev share is used"));

    await expect(askNoul("ws-1", QUESTION, {})).rejects.toThrow(JevUnavailableError);

    expect(caps.share).toHaveBeenCalledWith("ws-1");
    expect(ai.run).not.toHaveBeenCalled();
  });
});
