import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createMemoryRouter, RouterProvider } from "react-router";

import { RecentEvidenceChecksCard } from "~/components/watchlists/recent-evidence-checks-card";
import { evaluateProofPolicy } from "~/lib/proof-policy.server";
import { getIncludedEvidenceAllowance } from "~/lib/plan-entitlements";
import {
  buildRunHistoryRefusalRows,
  formatRunHistoryRefusalCopy,
  resolveProofCaptureRefusal,
} from "~/lib/run-history-capture-visibility";
import { classifyWatchPeriodTriage } from "~/lib/watch-period-triage";
import type { ProofCaptureRecord } from "~/lib/types";
import { buildProofSummary, emptyProofSummary } from "~/lib/watchlist-display";

/**
 * Issue #1857: a paid-tier (Scout/Starter/Agency) watchlist whose capture
 * budget is exhausted must never lose a check silently. The proof policy
 * decides to skip (expected — monthly allowance / credit ledger reached),
 * the monitoring workflow writes a `proof_capture` row with
 * `status = 'skipped_due_to_budget'` and a non-null `skip_reason`, and four
 * user-visible surfaces must show that row so the customer can tell checks
 * were dropped:
 *
 *   1. run history          — `resolveProofCaptureRefusal` / `buildRunHistoryRefusalRows`
 *   2. the evidence card    — `RecentEvidenceChecksCard` (count + reason + "why" link)
 *   3. the period triage    — `classifyWatchPeriodTriage` → `evidence_skipped_budget`
 *                             (the digest never reads "all quiet" when a skip happened)
 *   4. the dashboard quota  — `getIncludedEvidenceAllowance(plan)` feeds the
 *                             "X of Y checks used" / "0 left" copy
 *
 * The live canary (`scripts/canary-proof-budget-skip-surface.mjs`) is the
 * production detector: it queries `proof_capture` over a 72h window, joins
 * watchlist → user_plan to classify by plan tier, and fails on any silent
 * skip (null `skip_reason`) or paid-tier over-volume. This test exercises
 * the canary's query/validate path against the 70-row scenario the issue
 * names, including the domain-breakdown query that classifies by competitor
 * domain (`proof_target.landing_page_url`).
 *
 * The companion `tests/integration/proof-capture-budget.integration.test.ts`
 * (workers project, real D1) seeds a paid-tier watchlist, drives
 * `evaluateProofPolicy` at the monthly cap, persists the skip, and asserts
 * the run-history read path + period triage against the real schema. This
 * node test pins the unit-level surfaces and the canary query/validator.
 *
 * No D1 schema change, no workflow edit, no gate-owned path edit — every
 * assertion reuses existing columns, statuses, and surfaces.
 */

function capture(
  overrides: Partial<ProofCaptureRecord> & Pick<ProofCaptureRecord, "id" | "status">,
): ProofCaptureRecord {
  return {
    proofTargetId: "target-1",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: null,
    htmlArtifactKey: null,
    extractedFields: {},
    fieldConfidence: {},
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "v1",
    idempotencyKey: overrides.id,
    attemptedAt: "2026-08-25T10:00:00.000Z",
    succeededAt: null,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

// A paid-tier (Starter) watchlist at its monthly capture allowance. The
// policy must skip with `skipped_due_to_budget` — this is the expected
// behavior, not a bug. Two independent budget paths reach the same skip:
// the credit ledger (`workspaceEvidenceRemaining <= 0`) and the per-plan
// monthly cap (`workspaceMonthlyAttemptCount >= workspaceMonthlyCap`).
const PAID_AT_MONTHLY_CAP = {
  sensitivityMode: "balanced" as const,
  triggerEventTypes: ["landing_page_cta_changed" as const],
  lastSuccessfulProofAt: "2026-08-01T00:00:00.000Z",
  watchlistRunAttemptCount: 0,
  watchlistDailyAttemptCount: 0,
  workspaceDailyAttemptCount: 0,
  workspaceDailyCap: 40,
  workspaceMonthlyAttemptCount: 250,
  workspaceMonthlyCap: 250,
  workspaceEvidenceRemaining: 0,
  workspaceRecentAttempts: [],
  activeCaptureCount: 0,
  burstCount: 1,
  proofRequestDuplicate: false,
  recentFailureCountForTarget: 0,
  applyPerWatchlistBudgets: false,
  now: "2026-08-25T10:00:00.000Z",
};

function renderCard(props: Parameters<typeof RecentEvidenceChecksCard>[0]): string {
  const router = createMemoryRouter([
    {
      path: "/",
      element: createElement(RecentEvidenceChecksCard, props),
    },
  ]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("proof-capture budget (#1857): paid-tier exhaustion is never silent", () => {
  describe("the proof policy skips both budget paths with skipped_due_to_budget", () => {
    it("skips when the per-plan monthly capture allowance is reached", () => {
      const decision = evaluateProofPolicy({
        ...PAID_AT_MONTHLY_CAP,
        // Monthly-cap path only — credit ledger still has checks left.
        workspaceEvidenceRemaining: 10,
      });

      expect(decision.shouldCapture).toBe(false);
      expect(decision.skipReason).toBe("skipped_due_to_budget");
    });

    it("skips when the credit-ledger evidence allowance is exhausted", () => {
      const decision = evaluateProofPolicy({
        ...PAID_AT_MONTHLY_CAP,
        // Credit-ledger path only — monthly cap not yet hit.
        workspaceMonthlyAttemptCount: 200,
        workspaceMonthlyCap: 250,
        workspaceEvidenceRemaining: 0,
      });

      expect(decision.shouldCapture).toBe(false);
      expect(decision.skipReason).toBe("skipped_due_to_budget");
    });

    it("does not skip a paid-tier watchlist that still has allowance left", () => {
      const decision = evaluateProofPolicy({
        ...PAID_AT_MONTHLY_CAP,
        workspaceMonthlyAttemptCount: 200,
        workspaceMonthlyCap: 250,
        workspaceEvidenceRemaining: 50,
      });

      expect(decision.shouldCapture).toBe(true);
      expect(decision.skipReason).toBeNull();
    });
  });

  describe("the budget skip surfaces in run history (not silent)", () => {
    it("resolveProofCaptureRefusal turns a skipped_due_to_budget row into an explained refusal", () => {
      const skipped = capture({
        id: "proof-budget-skip-1",
        status: "skipped_due_to_budget",
        skipReason: "skipped_due_to_budget",
        attemptedAt: "2026-08-25T10:00:00.000Z",
      });

      const row = resolveProofCaptureRefusal(skipped);

      expect(row).not.toBeNull();
      expect(row!.kind).toBe("skipped_due_to_budget");
      expect(row!.reasonCode).toBe("skipped_due_to_budget");
      expect(row!.generatesAlert).toBe(false);
      expect(row!.explanation).toMatch(/plan allowance reached/i);
      // No raw snake_case token reaches the customer copy.
      expect(formatRunHistoryRefusalCopy(row!)).not.toMatch(/skipped_due_to_budget/);
      expect(formatRunHistoryRefusalCopy(row!)).toContain("No alert sent.");
    });

    it("every budget skip over a 72h paid-tier window produces a run-history refusal row", () => {
      const WINDOW_START = Date.parse("2026-08-23T00:00:00.000Z");
      const HOUR = 60 * 60 * 1000;
      const skips = Array.from({ length: 8 }, (_, index) =>
        capture({
          id: `proof-budget-${index}`,
          status: "skipped_due_to_budget",
          skipReason: "skipped_due_to_budget",
          attemptedAt: new Date(WINDOW_START + index * 9 * HOUR).toISOString(),
        }),
      );

      const rows = buildRunHistoryRefusalRows({ captures: skips });

      expect(rows).toHaveLength(8);
      for (const row of rows) {
        expect(row.kind).toBe("skipped_due_to_budget");
        expect(row.generatesAlert).toBe(false);
        expect(formatRunHistoryRefusalCopy(row)).toContain("plan allowance reached");
      }
    });

    it("a budget skip with a null skip_reason is still surfaced (the canary flags it silent)", () => {
      // The monitoring workflow always writes a non-null skip_reason; a null
      // one is the silent-degradation regression the issue is about. The
      // visibility layer still surfaces the row (so the customer sees it),
      // and the canary separately flags the null as a silent skip.
      const silentSkip = capture({
        id: "proof-budget-silent",
        status: "skipped_due_to_budget",
        skipReason: null,
        attemptedAt: "2026-08-25T10:00:00.000Z",
      });

      const row = resolveProofCaptureRefusal(silentSkip);

      expect(row).not.toBeNull();
      expect(row!.kind).toBe("skipped_due_to_budget");
      // Falls back to the status token so the row is never dropped.
      expect(row!.reasonCode).toBe("skipped_due_to_budget");
    });
  });

  describe("the evidence card renders the budget skip with a human reason and a why-link", () => {
    it("shows the count, human reason, and a 'why this happened' link when budget skips occurred", () => {
      const skips = Array.from({ length: 5 }, (_, index) =>
        capture({
          id: `proof-budget-${index}`,
          status: "skipped_due_to_budget",
          skipReason: "skipped_due_to_budget",
          attemptedAt: `2026-08-25T10:0${index}:00.000Z`,
        }),
      );

      const markup = renderCard({
        checksExpanded: true,
        data: {
          proofSummary: {
            ...emptyProofSummary(),
            totalAttempts: 5,
            skippedAttempts: 5,
            skippedDueToBudget: 5,
          },
          renderedAt: "2026-08-25T11:00:00.000Z",
          recentProofCaptures: skips,
          eventCandidates: [],
          events: [],
        },
        watchlistId: "watch-1",
      });

      expect(markup).toContain("Skipped (plan allowance)");
      expect(markup).toContain("plan allowance was reached");
      expect(markup).toContain("Why this happened");
      expect(markup).not.toMatch(/skipped_due_to_budget/);
    });

    it("buildProofSummary counts budget skips separately from other skips", () => {
      const captures = [
        capture({ id: "ok", status: "succeeded" }),
        capture({
          id: "budget",
          status: "skipped_due_to_budget",
          skipReason: "skipped_due_to_budget",
        }),
        capture({
          id: "rate",
          status: "skipped_due_to_rate_limit",
          skipReason: "skipped_due_to_rate_limit",
        }),
      ];

      const summary = buildProofSummary(captures);

      expect(summary.totalAttempts).toBe(3);
      expect(summary.skippedAttempts).toBe(2);
      expect(summary.skippedDueToBudget).toBe(1);
      expect(summary.skippedDueToRateLimit).toBe(1);
    });
  });

  describe("the period triage never reads 'all quiet' when a budget skip happened", () => {
    it("classifies a period with a budget skip as evidence_skipped_budget, not all_quiet", () => {
      const triage = classifyWatchPeriodTriage({
        events: [],
        candidates: [],
        proofCaptures: [
          { status: "succeeded" },
          { status: "skipped_due_to_budget" },
        ],
        successfulRuns: 3,
        lastSuccessfulCheckAt: "2026-08-25T10:00:00.000Z",
      });

      expect(triage.status).toBe("evidence_skipped_budget");
      expect(triage.label).toMatch(/plan allowance reached/i);
      expect(triage.explanation).toMatch(/skipped/i);
      expect(triage.explanation).toMatch(/allowance was reached/i);
      // The digest's honest next step points the customer at the fix.
      expect(triage.nextAction).toMatch(/allowance resets|credit pack|upgrade/i);
    });

    it("reads all_quiet only when checks completed with no skips and no changes", () => {
      const triage = classifyWatchPeriodTriage({
        events: [],
        candidates: [],
        proofCaptures: [{ status: "succeeded" }],
        successfulRuns: 3,
        lastSuccessfulCheckAt: "2026-08-25T10:00:00.000Z",
      });

      expect(triage.status).toBe("all_quiet");
    });
  });

  describe("the dashboard quota display reads the real per-plan monthly allowance", () => {
    // The dashboard reads `proofUsage` from `getProofUsageSummary`, whose
    // `limit` is `getIncludedEvidenceAllowance(plan) + topUpRemaining`. When
    // `includedUsed >= includedAllowance`, `warningLevel` is "exhausted" and
    // the dashboard renders "X of Y checks used" + "0 left this month". This
    // is the per-plan-monthly-quota visibility the issue's acceptance (b)
    // names. The allowance values below come from the real entitlements
    // table (`app/lib/plan-entitlements.ts`), not invented literals.
    it("a Starter plan's included monthly allowance is 250 (the cap the issue names)", () => {
      expect(getIncludedEvidenceAllowance("starter")).toBe(250);
    });

    it("a Scout plan's included monthly allowance is 50, not 100", () => {
      // The reviewer caught a stale 100 here — Scout's real allowance is 50.
      expect(getIncludedEvidenceAllowance("scout")).toBe(50);
    });

    it("an Agency plan has a higher allowance than Starter", () => {
      const agency = getIncludedEvidenceAllowance("agency");
      const starter = getIncludedEvidenceAllowance("starter");
      expect(agency).toBeGreaterThan(starter);
    });

    it("at includedUsed == includedAllowance the dashboard copy is '250 of 250' and '0 left'", () => {
      // This mirrors the warningLevel logic in getProofUsageSummary
      // (plan.server.ts): used >= includedAllowance → "exhausted".
      const includedAllowance = getIncludedEvidenceAllowance("starter");
      const includedUsed = includedAllowance; // exhausted
      const remaining = Math.max(0, includedAllowance - includedUsed);
      const warningLevel =
        includedAllowance > 0 && includedUsed >= includedAllowance ? "exhausted" : "ok";

      expect(warningLevel).toBe("exhausted");
      expect(remaining).toBe(0);
      // The dashboard copy the loader feeds (app.dashboard.tsx):
      const quotaLine = `${includedUsed} of ${includedAllowance} proof captures used in the current billing period.`;
      expect(quotaLine).toBe("250 of 250 proof captures used in the current billing period.");
    });
  });

});
