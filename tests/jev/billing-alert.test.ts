import { captureException } from "@sentry/cloudflare";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: { AI: ai } }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
vi.mock("../../app/lib/data/jev_verdict.server", () => ({
  readCachedNoul: () => Promise.resolve(null),
  readCachedChoice: () => Promise.resolve(null),
}));

import { askNoul, askNouls, JevUnavailableError, type NoulQuestion } from "../../app/lib/jev/client.server";

const QUESTION: NoulQuestion = { id: "q", instructions: "i", whenTrue: "t", whenFalse: "f" };

beforeEach(() => {
  vi.mocked(captureException).mockClear();
  ai.run.mockReset();
});

describe("a Jev call the AI credits refuse", () => {
  it("raises one error-level Sentry event carrying the cause and no input", async () => {
    ai.run.mockRejectedValue(new Error("2021: Payment error"));

    await expect(askNoul("ws-1", QUESTION, { secret: "brand" })).rejects.toThrow(JevUnavailableError);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [captured, hint] = vi.mocked(captureException).mock.calls[0] ?? [];
    expect(String(captured)).toBe("Error: jev refused: Workers AI quota, AI Gateway credits or payment");
    expect(JSON.stringify(hint)).not.toContain("brand");
    expect(hint).toMatchObject({ level: "error", fingerprint: ["jev-billing-refused"] });
  });

  it("does the same for a batch", async () => {
    ai.run.mockRejectedValue(new Error("402 Insufficient balance"));

    await expect(askNouls("ws-1", [QUESTION], {})).rejects.toThrow(JevUnavailableError);

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("does the same when Workers AI says the daily free allocation is used up", async () => {
    ai.run.mockRejectedValue(new Error("3036: You have used up your daily free allocation of 10,000 neurons."));

    await expect(askNoul("ws-1", QUESTION, {})).rejects.toThrow(JevUnavailableError);

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("sends the Clef model selector in the request body", async () => {
    ai.run.mockResolvedValue({ model: "clef", answers: { q: { type: "noul", noul: 0.7 } } });

    await askNoul("ws-1", QUESTION, {});

    expect(ai.run).toHaveBeenCalledWith("@cf/cloudflare/clef", expect.objectContaining({ model: "clef" }), {
      gateway: { id: "default" },
    });
  });

  it("stays quiet for an ordinary outage such as a timeout", async () => {
    ai.run.mockRejectedValue(new Error("gateway timed out"));

    await expect(askNoul("ws-1", QUESTION, {})).rejects.toThrow(JevUnavailableError);

    expect(captureException).not.toHaveBeenCalled();
  });
});
