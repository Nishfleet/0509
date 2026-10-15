import { captureException } from "@sentry/cloudflare";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ run: vi.fn() }));
const failures = vi.hoisted(() => ({ insertJevFailure: vi.fn(() => Promise.resolve()) }));

vi.mock("cloudflare:workers", () => ({ env: { AI: ai, AI_SPEND: "off" }, waitUntil: vi.fn() }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
vi.mock("../../app/lib/data/jev_failure.server", () => failures);
vi.mock("../../app/lib/data/jev_verdict.server", () => ({
  readCachedNoul: () => Promise.resolve(null),
  readCachedChoice: () => Promise.resolve(null),
}));

import {
  askChoice,
  askNoul,
  askNouls,
  JevRateLimitedError,
  JevSpendOffError,
  JevUnavailableError,
  type NoulQuestion,
} from "../../app/lib/jev/client.server";

const QUESTION: NoulQuestion = { id: "q", instructions: "i", whenTrue: "t", whenFalse: "f" };
const CHOICE = { id: "c", instructions: "i", options: { a: "A", b: "B" } };

const calls = [
  ["askNoul", () => askNoul("ws-1", QUESTION, {})],
  ["askNouls", () => askNouls("ws-1", [QUESTION], {})],
  ["askChoice", () => askChoice("ws-1", CHOICE, {})],
] as const;

beforeEach(() => {
  ai.run.mockReset();
  failures.insertJevFailure.mockClear();
  vi.mocked(captureException).mockClear();
});

describe("a Jev call while the ai spend kill switch is off (0509#7191)", () => {
  it.each(calls)("%s refuses before the model is called and writes no jev_failure row", async (_, call) => {
    const failure: unknown = await call().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JevSpendOffError);
    expect(failure).toBeInstanceOf(JevUnavailableError);
    expect(failure).not.toBeInstanceOf(JevRateLimitedError);
    expect(failure).toHaveProperty("message", expect.stringContaining("ai spend is off: AI_SPEND=off"));
    expect(ai.run).not.toHaveBeenCalled();
    expect(failures.insertJevFailure).not.toHaveBeenCalled();
  });

  it.each(calls)("%s raises the ai-spend-off alert, not the jev billing one", async (_, call) => {
    await call().catch(() => null);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureException).mock.calls[0]?.[1]).toEqual({ level: "error", fingerprint: ["ai-spend-off"] });
  });
});
