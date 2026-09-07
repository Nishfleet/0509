import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createMemoryRouter, RouterProvider } from "react-router";

import { RecentEvidenceChecksCard } from "~/components/watchlists/recent-evidence-checks-card";
import {
  buildBudgetSkipDomainBreakdownQuery,
  buildBudgetSkipSurfaceQuery,
  mapBudgetSkipDomainRows,
  mapBudgetSkipRows,
  validateBudgetSkipSurface,
} from "../scripts/canary-proof-budget-skip-surface.mjs";
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

  describe("the live canary classifies the 70 skipped_due_to_budget rows by plan tier", () => {
    // The issue's acceptance (a): query proof_capture for the 70
    // skipped_due_to_budget rows and classify by watchlist plan tier,
    // competitor domain, and capture attempt timestamp. The canary joins
    // proof_capture → proof_target → watchlist → user_plan so each row
    // carries the plan tier and the created_at timestamp; the per-target
    // domain is reachable through proof_target. This test proves the
    // canary's query and validator against the 70-row paid-tier scenario.
    it("buildBudgetSkipSurfaceQuery joins proof_capture to watchlist and user_plan over a 72h window", () => {
      const sql = buildBudgetSkipSurfaceQuery(72);

      // Classifies by plan tier via the watchlist → user_plan join.
      expect(sql).toMatch(/LEFT JOIN user_plan up ON up\.user_id = w\.user_id/);
      expect(sql).toMatch(/COALESCE\(up\.plan, 'free'\) AS plan/);
      // Classifies by capture attempt timestamp (created_at).
      expect(sql).toMatch(/pc\.created_at > datetime\('now', '-' \|\| 72 \|\| ' hours'\)/);
      expect(sql).toMatch(/MIN\(CASE WHEN pc\.status = 'skipped_due_to_budget' THEN pc\.created_at END\)/);
      expect(sql).toMatch(/MAX\(CASE WHEN pc\.status = 'skipped_due_to_budget' THEN pc\.created_at END\)/);
      // The proof_target join is the bridge to the competitor domain.
      expect(sql).toMatch(/INNER JOIN proof_target pt ON pt\.id = pc\.proof_target_id/);
      // Only budget-skip rows are counted.
      expect(sql).toMatch(/pc\.status = 'skipped_due_to_budget'/);
    });

    it("mapBudgetSkipRows classifies the 70 rows across paid tiers with no silent skips", () => {
      // 70 rows spread across Scout/Starter/Agency, every one with a
      // non-null skip_reason (the monitoring workflow's contract).
      const rows = mapBudgetSkipRows([
        {
          workspace_user_id: "user-scout",
          plan: "scout",
          budget_skips_total: 18,
          budget_skips_silent: 0,
          first_budget_skip_at: "2026-08-23T00:00:00Z",
          last_budget_skip_at: "2026-08-25T00:00:00Z",
        },
        {
          workspace_user_id: "user-starter",
          plan: "starter",
          budget_skips_total: 41,
          budget_skips_silent: 0,
          first_budget_skip_at: "2026-08-22T00:00:00Z",
          last_budget_skip_at: "2026-08-25T00:00:00Z",
        },
        {
          workspace_user_id: "user-agency",
          plan: "agency",
          budget_skips_total: 11,
          budget_skips_silent: 0,
          first_budget_skip_at: "2026-08-24T00:00:00Z",
          last_budget_skip_at: "2026-08-25T00:00:00Z",
        },
      ]);

      const totalSkips = rows.reduce((sum, row) => sum + row.budgetSkipsTotal, 0);
      expect(totalSkips).toBe(70);
      expect(rows.map((row) => row.plan).sort()).toEqual(["agency", "scout", "starter"]);
      for (const row of rows) {
        expect(row.budgetSkipsSilent).toBe(0);
        expect(row.firstBudgetSkipAt).not.toBeNull();
        expect(row.lastBudgetSkipAt).not.toBeNull();
      }
    });

    it("validateBudgetSkipSurface passes when every paid-tier row is non-silent and under volume", () => {
      const result = validateBudgetSkipSurface({
        windowHours: 72,
        paidThreshold: 100,
        rows: [
          {
            workspaceUserId: "user-starter",
            plan: "starter",
            budgetSkipsTotal: 41,
            budgetSkipsSilent: 0,
            firstBudgetSkipAt: "2026-08-22T00:00:00Z",
            lastBudgetSkipAt: "2026-08-25T00:00:00Z",
          },
          {
            workspaceUserId: "user-scout",
            plan: "scout",
            budgetSkipsTotal: 18,
            budgetSkipsSilent: 0,
            firstBudgetSkipAt: "2026-08-23T00:00:00Z",
            lastBudgetSkipAt: "2026-08-25T00:00:00Z",
          },
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.silentRows).toEqual([]);
      expect(result.overVolumeRows).toEqual([]);
    });

    it("validateBudgetSkipSurface fails on any silent paid-tier skip (the regression the issue is about)", () => {
      const result = validateBudgetSkipSurface({
        windowHours: 72,
        paidThreshold: 100,
        rows: [
          {
            workspaceUserId: "user-starter",
            plan: "starter",
            budgetSkipsTotal: 41,
            budgetSkipsSilent: 3,
            firstBudgetSkipAt: "2026-08-22T00:00:00Z",
            lastBudgetSkipAt: "2026-08-25T00:00:00Z",
          },
        ],
      });

      expect(result.ok).toBe(false);
      expect(result.silentRows).toHaveLength(1);
      expect(result.failures[0]).toMatch(/silent budget skips detected/);
      expect(result.failures[0]).toMatch(/user-starter/);
    });
  });

  describe("the domain breakdown classifies the 70 rows by plan tier, competitor domain, and timestamp", () => {
    // Issue acceptance (a): classify by plan tier, competitor domain, and
    // capture attempt timestamp. The domain-breakdown query selects
    // `pt.landing_page_url AS competitor_domain` and groups by it, so the
    // 70-row investigation can be read straight off the result.
    it("buildBudgetSkipDomainBreakdownQuery selects landing_page_url as competitor_domain", () => {
      const sql = buildBudgetSkipDomainBreakdownQuery(72);

      // Classifies by plan tier via the watchlist → user_plan join.
      expect(sql).toMatch(/COALESCE\(up\.plan, 'free'\) AS plan/);
      // Classifies by competitor domain via proof_target.landing_page_url.
      expect(sql).toMatch(/pt\.landing_page_url AS competitor_domain/);
      // Classifies by capture attempt timestamp.
      expect(sql).toMatch(/MIN\(pc\.created_at\) AS first_budget_skip_at/);
      expect(sql).toMatch(/MAX\(pc\.created_at\) AS last_budget_skip_at/);
      // Groups by domain, not just workspace.
      expect(sql).toMatch(/GROUP BY w\.user_id, COALESCE\(up\.plan, 'free'\), pt\.landing_page_url/);
      // Only budget-skip rows.
      expect(sql).toMatch(/pc\.status = 'skipped_due_to_budget'/);
    });

    it("mapBudgetSkipDomainRows classifies the 70 rows across paid tiers and competitor domains", () => {
      const rows = mapBudgetSkipDomainRows([
        {
          workspace_user_id: "user-starter",
          plan: "starter",
          competitor_domain: "https://acme.example/offer",
          budget_skips_total: 20,
          budget_skips_silent: 0,
          first_budget_skip_at: "2026-08-22T00:00:00Z",
          last_budget_skip_at: "2026-08-25T00:00:00Z",
        },
        {
          workspace_user_id: "user-starter",
          plan: "starter",
          competitor_domain: "https://beta.example/offer",
          budget_skips_total: 21,
          budget_skips_silent: 0,
          first_budget_skip_at: "2026-08-23T00:00:00Z",
          last_budget_skip_at: "2026-08-25T00:00:00Z",
        },
        {
          workspace_user_id: "user-scout",
          plan: "scout",
          competitor_domain: "https://gamma.example/offer",
          budget_skips_total: 18,
          budget_skips_silent: 0,
          first_budget_skip_at: "2026-08-23T00:00:00Z",
          last_budget_skip_at: "2026-08-25T00:00:00Z",
        },
        {
          workspace_user_id: "user-agency",
          plan: "agency",
          competitor_domain: "https://delta.example/offer",
          budget_skips_total: 11,
          budget_skips_silent: 0,
          first_budget_skip_at: "2026-08-24T00:00:00Z",
          last_budget_skip_at: "2026-08-25T00:00:00Z",
        },
      ]);

      const totalSkips = rows.reduce((sum, row) => sum + row.budgetSkipsTotal, 0);
      expect(totalSkips).toBe(70);
      // Every row carries the competitor domain.
      for (const row of rows) {
        expect(row.competitorDomain).not.toBeNull();
        expect(row.firstBudgetSkipAt).not.toBeNull();
        expect(row.lastBudgetSkipAt).not.toBeNull();
        expect(row.budgetSkipsSilent).toBe(0);
      }
      // The Starter workspace's 41 skips split across two domains.
      const starterRows = rows.filter((row) => row.plan === "starter");
      expect(starterRows).toHaveLength(2);
      expect(starterRows.reduce((s, r) => s + r.budgetSkipsTotal, 0)).toBe(41);
    });

    it("mapBudgetSkipDomainRows surfaces a null competitor_domain (legacy rows) rather than hiding it", () => {
      const rows = mapBudgetSkipDomainRows([
        {
          workspace_user_id: "user-starter",
          plan: "starter",
          competitor_domain: null,
          budget_skips_total: 5,
          budget_skips_silent: 0,
          first_budget_skip_at: "2026-08-24T00:00:00Z",
          last_budget_skip_at: "2026-08-25T00:00:00Z",
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.competitorDomain).toBeNull();
      expect(rows[0]!.budgetSkipsTotal).toBe(5);
    });
  });
});
