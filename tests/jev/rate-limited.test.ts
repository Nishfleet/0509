import { captureException, captureMessage } from "@sentry/cloudflare";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ run: vi.fn() }));
const cache = vi.hoisted(() => ({ readChoice: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: { AI: ai, AI_SPEND: "on" } }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("../../app/lib/data/jev_verdict.server", () => ({
  readCachedNoul: () => Promise.resolve(null),
  readCachedChoice: cache.readChoice,
}));

import {
  askChoices,
  askNoul,
  askNouls,
  JevRateLimitedError,
  JevUnavailableError,
  type NoulQuestion,
} from "../../app/lib/jev/client.server";

const QUESTION: NoulQuestion = { id: "q", instructions: "i", whenTrue: "t", whenFalse: "f" };

beforeEach(() => {
  ai.run.mockReset();
  cache.readChoice.mockReset();
  cache.readChoice.mockResolvedValue(null);
  vi.mocked(captureMessage).mockClear();
  vi.mocked(captureException).mockClear();
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

describe("a batch of choice questions that Clef rate limits", () => {
  const CHOICE = { id: "c", instructions: "i", options: { a: "a", b: "b" } };

  it("reports the outage to Sentry once and asks no further after the first limited chunk", async () => {
    ai.run.mockRejectedValue(new Error("2003: Rate limited"));

    const settled = await askChoices(
      "ws-1",
      CHOICE,
      Array.from({ length: 40 }, () => ({})),
    );

    expect(settled).toHaveLength(40);
    expect(ai.run).toHaveBeenCalledTimes(4);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when nothing was rate limited", async () => {
    ai.run.mockResolvedValue({ answers: { c: { type: "choice", choice: "a" } } });

    await askChoices("ws-1", CHOICE, [{}, {}]);

    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("stops on a billing refusal too and sends one batch message", async () => {
    ai.run.mockRejectedValue(new Error("2021: Payment error"));

    const settled = await askChoices(
      "ws-1",
      CHOICE,
      Array.from({ length: 40 }, () => ({})),
    );

    expect(settled).toHaveLength(40);
    expect(ai.run).toHaveBeenCalledTimes(4);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports answers rejected for other reasons once when some verdicts landed", async () => {
    ai.run.mockResolvedValue({ answers: { c: { type: "choice", choice: "a" } } });
    cache.readChoice
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("d1 down"))
      .mockRejectedValueOnce(new Error("d1 down"));

    const settled = await askChoices("ws-1", CHOICE, [{}, {}, {}]);

    expect(settled.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected", "rejected"]);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      "jev choice batch: answers rejected",
      expect.objectContaining({ extra: { rejected: 2, asked: 3 } }),
    );
  });
});
