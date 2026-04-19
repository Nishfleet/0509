import { describe, expect, it } from "vitest";

import {
  buildCanonicalPageIdentity,
  buildProofTargetIdentity,
  evaluateProofPolicy,
} from "~/lib/proof-policy.server";

describe("proof policy", () => {
  it("normalizes canonical landing-page identity by stripping tracking params", () => {
    expect(
      buildCanonicalPageIdentity(
        "https://Example.com/Glow/?utm_source=facebook&fbclid=abc123&plan=pro#hero",
      ),
    ).toBe("example.com/Glow?plan=pro");
  });

  it("builds a watchlist-aware and ad-aware proof target identity", () => {
    expect(
      buildProofTargetIdentity({
        watchlistId: "watch-1",
        adId: "meta-boat-1",
        canonicalPageIdentity: "example.com/glow?plan=pro",
      }),
    ).toBe("watch-1:meta-boat-1:example.com/glow?plan=pro");
  });

  it("forces proof for landing-page URL changes even when normal budgets are exhausted", () => {
    const decision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: ["landing_page_url_changed"],
      lastSuccessfulProofAt: "2026-04-10T00:00:00.000Z",
      watchlistRunAttemptCount: 8,
      watchlistDailyAttemptCount: 30,
      workspaceDailyAttemptCount: 120,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(decision).toMatchObject({
      shouldCapture: true,
      forced: true,
      bucket: "event-triggered",
      skipReason: null,
    });
  });

  it("treats auto as balanced in v1 and skips fresh unchanged pages", () => {
    const decision = evaluateProofPolicy({
      sensitivityMode: "auto",
      triggerEventTypes: [],
      lastSuccessfulProofAt: "2026-04-17T12:00:00.000Z",
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 2,
      workspaceDailyAttemptCount: 8,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(decision.threshold).toBe(70);
    expect(decision.shouldCapture).toBe(false);
    expect(decision.forced).toBe(false);
  });

  it("opens a first-proof capture on non-quiet watchlists with no prior successful proof", () => {
    const decision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: ["ad_new"],
      lastSuccessfulProofAt: null,
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 0,
      workspaceDailyAttemptCount: 0,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(decision).toMatchObject({
      shouldCapture: true,
      forced: true,
      bucket: "event-triggered",
      skipReason: null,
    });
  });

  it("blocks non-forced freshness captures when the circuit breaker is open", () => {
    const decision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: [],
      lastSuccessfulProofAt: "2026-04-01T00:00:00.000Z",
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 2,
      workspaceDailyAttemptCount: 8,
      workspaceRecentAttempts: [
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "succeeded" },
        { status: "succeeded" },
        { status: "succeeded" },
        { status: "succeeded" },
        { status: "succeeded" },
        { status: "succeeded" },
        { status: "succeeded" },
        { status: "succeeded" },
        { status: "succeeded" },
      ],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.skipReason).toBe("skipped_due_to_rate_limit");
    expect(decision.bucket).toBe("freshness-triggered");
  });
});
