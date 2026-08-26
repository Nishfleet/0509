import { describe, expect, it } from "vitest";

import {
  buildCanonicalPageIdentity,
  buildProofTargetIdentity,
  countRecentProofFailures,
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

  it("lets old landing failures age out of the per-target retry cooldown", () => {
    const now = "2026-04-18T12:00:00.000Z";
    const failures = [
      { status: "failed" as const, attemptedAt: "2026-04-18T11:00:00.000Z" },
      { status: "failed" as const, attemptedAt: "2026-04-17T11:00:00.000Z" },
      { status: "succeeded" as const, attemptedAt: "2026-04-18T11:30:00.000Z" },
    ];

    expect(countRecentProofFailures(failures, now)).toBe(1);
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

  it("blocks proof once the workspace monthly plan cap is exhausted", () => {
    const decision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: ["landing_page_url_changed"],
      lastSuccessfulProofAt: "2026-04-10T00:00:00.000Z",
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 0,
      workspaceDailyAttemptCount: 0,
      workspaceMonthlyAttemptCount: 250,
      workspaceMonthlyCap: 250,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(decision).toMatchObject({
      shouldCapture: false,
      forced: true,
      skipReason: "skipped_due_to_budget",
    });
  });

  it("blocks proof when subscription-period evidence remaining is zero", () => {
    const decision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: ["landing_page_url_changed"],
      lastSuccessfulProofAt: "2026-04-10T00:00:00.000Z",
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 0,
      workspaceDailyAttemptCount: 0,
      workspaceEvidenceRemaining: 0,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 0,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(decision).toMatchObject({
      shouldCapture: false,
      skipReason: "skipped_due_to_budget",
    });
  });

  it("honors the target failure cooldown even for a forced first proof", () => {
    const decision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: ["landing_page_url_changed"],
      lastSuccessfulProofAt: null,
      watchlistRunAttemptCount: 0,
      watchlistDailyAttemptCount: 0,
      workspaceDailyAttemptCount: 0,
      workspaceRecentAttempts: [],
      activeCaptureCount: 0,
      burstCount: 1,
      proofRequestDuplicate: false,
      recentFailureCountForTarget: 2,
      now: "2026-04-18T00:00:00.000Z",
    });

    expect(decision).toMatchObject({
      shouldCapture: false,
      forced: true,
      skipReason: "skipped_due_to_rate_limit",
    });
  });
});

describe("per-plan daily proof caps (2026-06-12)", () => {
  const baseInput = {
    sensitivityMode: "balanced" as const,
    triggerEventTypes: ["landing_page_headline_changed" as const],
    lastSuccessfulProofAt: null,
    watchlistRunAttemptCount: 0,
    watchlistDailyAttemptCount: 0,
    workspaceRecentAttempts: [],
    activeCaptureCount: 0,
    burstCount: 1,
    proofRequestDuplicate: false,
    recentFailureCountForTarget: 0,
  };

  it("lets an agency workspace pass the old flat 60/day ceiling", () => {
    const decision = evaluateProofPolicy({
      ...baseInput,
      workspaceDailyAttemptCount: 100,
      workspaceDailyCap: 120,
    });

    expect(decision.shouldCapture).toBe(true);
  });

  it("still budget-skips above the plan's own daily cap", () => {
    const decision = evaluateProofPolicy({
      ...baseInput,
      // forced captures bypass per-day budgets, so use a non-forced trigger
      triggerEventTypes: ["landing_page_cta_changed" as const],
      lastSuccessfulProofAt: "2026-06-10T00:00:00.000Z",
      workspaceDailyAttemptCount: 120,
      workspaceDailyCap: 120,
      now: "2026-06-12T00:00:00.000Z",
    });

    expect(decision.shouldCapture).toBe(false);
  });

  it("falls back to the flat v1 budget when no cap is provided", () => {
    const decision = evaluateProofPolicy({
      ...baseInput,
      triggerEventTypes: ["landing_page_cta_changed" as const],
      lastSuccessfulProofAt: "2026-06-10T00:00:00.000Z",
      workspaceDailyAttemptCount: 60,
      now: "2026-06-12T00:00:00.000Z",
    });

    expect(decision.shouldCapture).toBe(false);
  });
});

describe("paid-tier v1 per-watchlist budgets (Q3 #958)", () => {
  const paidFreshness = {
    sensitivityMode: "balanced" as const,
    triggerEventTypes: ["landing_page_cta_changed" as const],
    lastSuccessfulProofAt: "2026-04-01T00:00:00.000Z",
    watchlistRunAttemptCount: 0,
    watchlistDailyAttemptCount: 0,
    workspaceDailyAttemptCount: 0,
    workspaceDailyCap: 40,
    workspaceEvidenceRemaining: 200,
    workspaceRecentAttempts: [],
    activeCaptureCount: 0,
    burstCount: 1,
    proofRequestDuplicate: false,
    recentFailureCountForTarget: 0,
    applyPerWatchlistBudgets: false,
    now: "2026-04-18T00:00:00.000Z",
  };

  it("does not v1-budget-skip a paid watchlist that still has remaining checks", () => {
    const decision = evaluateProofPolicy({
      ...paidFreshness,
      watchlistRunAttemptCount: 8,
      watchlistDailyAttemptCount: 30,
    });

    expect(decision.shouldCapture).toBe(true);
    expect(decision.skipReason).toBeNull();
  });

  it("still budget-skips a paid watchlist when the plan allowance is exhausted", () => {
    const decision = evaluateProofPolicy({
      ...paidFreshness,
      workspaceEvidenceRemaining: 0,
    });

    expect(decision).toMatchObject({
      shouldCapture: false,
      skipReason: "skipped_due_to_budget",
    });
  });

  it("still budget-skips a paid watchlist above the plan daily cap", () => {
    const decision = evaluateProofPolicy({
      ...paidFreshness,
      workspaceDailyAttemptCount: 40,
      workspaceDailyCap: 40,
    });

    expect(decision).toMatchObject({
      shouldCapture: false,
      skipReason: "skipped_due_to_budget",
    });
  });

  it("still v1-budget-skips a free watchlist at 3 captures per run", () => {
    const decision = evaluateProofPolicy({
      ...paidFreshness,
      applyPerWatchlistBudgets: true,
      watchlistRunAttemptCount: 3,
    });

    expect(decision).toMatchObject({
      shouldCapture: false,
      skipReason: "skipped_due_to_budget",
    });
  });
});
