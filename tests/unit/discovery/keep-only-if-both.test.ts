import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

import type { NoulVerdict } from "../../../app/lib/jev/client.server";
import { keepOnlyIfBoth } from "../../../app/lib/discovery/run.server";
import { ACT_AT, noulAction, REJECT_AT } from "../../../app/lib/jev/thresholds";

function verdict(questionId: string, p: number): NoulVerdict {
  return { questionId, inputHash: `hash-${questionId}`, p, cached: false };
}

function combined(competitor: number, category: number): number {
  return keepOnlyIfBoth([verdict("is_competitor", competitor), verdict("same_category", category)]).p;
}

describe("keepOnlyIfBoth", () => {
  it("lifts a clear yes from the model's compressed scale to an automatic keep", () => {
    expect(noulAction(combined(0.8169, 0.7408))).toBe("act");
    expect(noulAction(combined(0.7819, 0.6543))).toBe("act");
    expect(noulAction(combined(0.9033, 0.9319))).toBe("act");
  });

  it("keeps a score under the clear-yes mark as it was", () => {
    expect(combined(0.8052, 0.55)).toBe(0.55);
    expect(noulAction(combined(0.6735, 0.5))).toBe("maybe");
  });

  it("scores a candidate off the category as zero however sure the competitor answer is", () => {
    expect(combined(0.8052, 0.4036)).toBe(0);
  });

  it("keeps an unlikely candidate rejected", () => {
    expect(noulAction(combined(0.084, 0.0469))).toBe("reject");
    expect(combined(0.084, 0.0469)).toBeLessThanOrEqual(REJECT_AT);
  });

  it("never lowers a score and never passes one", () => {
    const scores = [0.6, 0.65, 0.7, 0.8, 0.9, 0.95, 1];
    const lifted = scores.map((p) => combined(p, p));
    lifted.forEach((value, index) => {
      expect(value).toBeGreaterThanOrEqual(scores[index] ?? 0);
      expect(value).toBeLessThanOrEqual(1);
    });
    expect(lifted).toEqual([...lifted].sort((a, b) => a - b));
    expect(lifted[0]).toBeCloseTo(ACT_AT, 10);
  });

  it("returns the first verdict's question and hash", () => {
    const result = keepOnlyIfBoth([verdict("is_competitor", 0.8), verdict("same_category", 0.7)]);
    expect(result).toMatchObject({ questionId: "is_competitor", inputHash: "hash-is_competitor", cached: false });
  });

  it("refuses an empty list", () => {
    expect(() => keepOnlyIfBoth([])).toThrow("no verdicts to combine");
  });
});
