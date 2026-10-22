import { describe, expect, it, vi } from "vitest";
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

import type { NoulVerdict } from "../../../app/lib/jev/client.server";
import { keepOnlyIfBoth } from "../../../app/lib/discovery/run.server";
import { noulAction, REJECT_AT } from "../../../app/lib/jev/thresholds";

function verdict(questionId: string, p: number): NoulVerdict {
  return { questionId, inputHash: `hash-${questionId}`, p, cached: false };
}

function combined(competitor: number, category: number): number {
  return keepOnlyIfBoth([verdict("is_competitor", competitor), verdict("same_category", category)]).p;
}

describe("keepOnlyIfBoth", () => {
  it("passes the model's own score through, so a coin flip stays a coin flip", () => {
    expect(combined(0.5, 0.5)).toBe(0.5);
    expect(noulAction(combined(0.5, 0.5))).toBe("maybe");
    expect(combined(0.8169, 0.7408)).toBe(0.7408);
    expect(noulAction(combined(0.8169, 0.7408))).toBe("maybe");
  });

  it("acts only when the model itself is at the act line on both answers", () => {
    expect(combined(0.95, 0.92)).toBe(0.92);
    expect(noulAction(combined(0.95, 0.92))).toBe("act");
    expect(combined(0.9, 0.9)).toBe(0.9);
    expect(noulAction(combined(0.9, 0.9))).toBe("act");
    expect(combined(0.9, 0.89)).toBe(0.89);
    expect(noulAction(combined(0.9, 0.89))).toBe("maybe");
  });

  it("scores a candidate off the category as zero however sure the competitor answer is", () => {
    expect(combined(0.8052, 0.4036)).toBe(0);
  });

  it("zeroes a category score just under the floor", () => {
    expect(combined(0.9, 0.49)).toBe(0);
  });

  it("keeps an unlikely candidate rejected", () => {
    expect(noulAction(combined(0.084, 0.0469))).toBe("reject");
    expect(combined(0.084, 0.0469)).toBeLessThanOrEqual(REJECT_AT);
  });

  it("returns the lower of two unequal answers", () => {
    expect(combined(0.7, 0.6)).toBe(0.6);
    expect(combined(0.6, 0.7)).toBe(0.6);
  });

  it("returns the lowest of the answers and never more", () => {
    const scores = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
    scores.forEach((p) => {
      expect(combined(p, 1)).toBe(p);
      expect(combined(1, p)).toBe(p);
    });
  });

  it("returns the first verdict's question and hash", () => {
    const result = keepOnlyIfBoth([verdict("is_competitor", 0.8), verdict("same_category", 0.7)]);
    expect(result).toMatchObject({ questionId: "is_competitor", inputHash: "hash-is_competitor", cached: false });
  });

  it("refuses an empty list", () => {
    expect(() => keepOnlyIfBoth([])).toThrow("no verdicts to combine");
  });
});
