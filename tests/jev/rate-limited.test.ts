import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: { AI: ai } }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
vi.mock("../../app/lib/data/jev_verdict.server", () => ({
  readCachedNoul: () => Promise.resolve(null),
  readCachedChoice: () => Promise.resolve(null),
}));

import {
  askNoul,
  askNouls,
  JevRateLimitedError,
  JevUnavailableError,
  type NoulQuestion,
} from "../../app/lib/jev/client.server";

const QUESTION: NoulQuestion = { id: "q", instructions: "i", whenTrue: "t", whenFalse: "f" };

beforeEach(() => {
  ai.run.mockReset();
});

describe("a Jev call Clef rate limits", () => {
  it("raises the rate-limited error so the caller can back off", async () => {
    ai.run.mockRejectedValue(new Error("2003: Rate limited"));

    await expect(askNoul("ws-1", QUESTION, {})).rejects.toThrow(JevRateLimitedError);
    await expect(askNouls("ws-1", [QUESTION], {})).rejects.toThrow(JevRateLimitedError);
  });

  it("stays a Jev-unavailable error for callers that only degrade", async () => {
    ai.run.mockRejectedValue(new Error("2003: Rate limited"));

    await expect(askNoul("ws-1", QUESTION, {})).rejects.toThrow(JevUnavailableError);
  });

  it("never treats a billing refusal as rate limiting", async () => {
    ai.run.mockRejectedValue(new Error("2021: Payment error"));

    const failure: unknown = await askNoul("ws-1", QUESTION, {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JevUnavailableError);
    expect(failure).not.toBeInstanceOf(JevRateLimitedError);
  });

  it("leaves other failures as plain unavailable", async () => {
    ai.run.mockRejectedValue(new Error("Network connection lost"));

    const failure: unknown = await askNoul("ws-1", QUESTION, {}).catch((error: unknown) => error);

    expect(failure).not.toBeInstanceOf(JevRateLimitedError);
  });
});
