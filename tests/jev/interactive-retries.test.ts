import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("cloudflare:workers", () => ({ env: { AI: ai } }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
vi.mock("../../app/lib/data/jev_verdict.server", () => ({
  readCachedNoul: () => Promise.resolve(null),
  readCachedChoice: () => Promise.resolve(null),
  insertVerdict: vi.fn(),
}));

import { askNoul, askNouls, type NoulQuestion } from "../../app/lib/jev/client.server";
import { PUBLIC_SUBJECT } from "../../app/lib/jev/public-subject.server";
import { IS_COMPETITOR, SAME_CATEGORY } from "../../app/lib/discovery/run.server";

const PLAIN: NoulQuestion = { id: "q", instructions: "i", whenTrue: "t", whenFalse: "f" };

beforeEach(() => {
  ai.run.mockReset();
  ai.run.mockResolvedValue({
    answers: { q: { type: "noul", noul: 0.9 }, public_subject: { type: "noul", noul: 0.9 } },
  });
});

describe("the gateway retry policy of a Jev question", () => {
  it("is sent with the call when the question names one", async () => {
    const retries = { maxAttempts: 2, retryDelayMs: 300, backoff: "constant" } as const;

    await askNoul("ws-1", { ...PLAIN, retries }, {});

    expect(ai.run.mock.calls[0]?.[2]).toEqual({ gateway: { id: "default", retries } });
  });

  it("is left out of the call when the question names none", async () => {
    await askNoul("ws-1", PLAIN, {});

    expect(ai.run.mock.calls[0]?.[2]).toEqual({ gateway: { id: "default" } });
  });

  it("is set on the question that screens a brand at sign-up, bounded to three attempts", async () => {
    await askNoul("ws-1", PUBLIC_SUBJECT, {});

    expect(ai.run.mock.calls[0]?.[2]).toEqual({
      gateway: { id: "default", retries: { maxAttempts: 3, retryDelayMs: 500, backoff: "exponential" } },
    });
  });

  it("is never set on the two questions Discovery asks together, so a batch is never retried", async () => {
    ai.run.mockResolvedValue({
      answers: { is_competitor: { type: "noul", noul: 0.9 }, same_product_category: { type: "noul", noul: 0.9 } },
    });

    await askNouls("ws-1", [IS_COMPETITOR, SAME_CATEGORY], {});

    expect(IS_COMPETITOR.retries).toBeUndefined();
    expect(SAME_CATEGORY.retries).toBeUndefined();
    expect(ai.run.mock.calls[0]?.[2]).toEqual({ gateway: { id: "default" } });
  });
});
