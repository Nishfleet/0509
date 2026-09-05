import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createMemoryRouter, RouterProvider } from "react-router";

import { RecentEvidenceChecksCard } from "~/components/watchlists/recent-evidence-checks-card";
import {
  CAPTURE_BUDGET_SKIP_ANCHOR,
  CAPTURE_BUDGET_SKIP_HREF,
  CAPTURE_BUDGET_SKIP_PUBLIC_RULE,
  CAPTURE_RULES_PUBLIC_PATH,
} from "~/lib/capture-validity-public-rules";
import { evaluateProofPolicy } from "~/lib/proof-policy.server";
import {
  buildRunHistoryRefusalRows,
  formatRunHistoryRefusalCopy,
  resolveProofCaptureRefusal,
} from "~/lib/run-history-capture-visibility";
import type { ProofCaptureRecord } from "~/lib/types";
import { emptyProofSummary } from "~/lib/watchlist-display";

/**
 * Issue #1485: a paid-tier watchlist whose plan allowance is exhausted must
 * never lose captures silently. The proof policy decides to skip (expected
 * behavior — monthly limit / per-run budget guard), the monitoring workflow
 * writes a `proof_capture` row with `status = 'skipped_due_to_budget'`, and
 * the run-history surface must show that row with a human-friendly reason and
 * a "why this happened" link to `/capture-rules#budget-skip`.
 *
 * This test seeds the watchlist at its capture limit, runs the policy, then
 * drives the resulting skip through the run-history visibility layer and the
 * evidence card the customer sees — the same path the monitoring workflow
 * feeds in production.
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
    attemptedAt: "2026-08-31T10:00:00.000Z",
    succeededAt: null,
    createdAt: "2026-08-31T10:00:00.000Z",
    updatedAt: "2026-08-31T10:00:00.000Z",
    ...overrides,
  };
}

// A paid-tier (Starter) watchlist at its capture limit: the workspace has
// spent every remaining check this period. The policy must skip with
// `skipped_due_to_budget` — this is the expected (a)/(b) behavior the issue
// names, not a bug.
const PAID_AT_LIMIT = {
  sensitivityMode: "balanced" as const,
  triggerEventTypes: ["landing_page_cta_changed" as const],
  lastSuccessfulProofAt: "2026-08-01T00:00:00.000Z",
  watchlistRunAttemptCount: 0,
  watchlistDailyAttemptCount: 0,
  workspaceDailyAttemptCount: 0,
  workspaceDailyCap: 40,
  workspaceEvidenceRemaining: 0,
  workspaceRecentAttempts: [],
  activeCaptureCount: 0,
  burstCount: 1,
  proofRequestDuplicate: false,
  recentFailureCountForTarget: 0,
  applyPerWatchlistBudgets: false,
  now: "2026-08-31T10:00:00.000Z",
};

describe("budget-skip visibility (#1485)", () => {
  // RecentEvidenceChecksCard renders a react-router <Link> for the "why this
  // happened" anchor, so the card needs a router context to render to static
  // markup (a bare useContext for the router basename is null otherwise).
  function renderCard(props: Parameters<typeof RecentEvidenceChecksCard>[0]): string {
    const router = createMemoryRouter([
      {
        path: "/",
        element: createElement(RecentEvidenceChecksCard, props),
      },
    ]);
    return renderToStaticMarkup(createElement(RouterProvider, { router }));
  }

  it("the proof policy skips with skipped_due_to_budget when the plan allowance is exhausted", () => {
    const decision = evaluateProofPolicy(PAID_AT_LIMIT);

    expect(decision.shouldCapture).toBe(false);
    expect(decision.skipReason).toBe("skipped_due_to_budget");
  });

  it("the monitoring workflow's budget-skip row surfaces in run history with a human-friendly reason", () => {
    // The workflow writes the policy decision as a proof_capture row.
    const skippedCapture = capture({
      id: "proof-budget-skip-1",
      status: "skipped_due_to_budget",
      skipReason: "skipped_due_to_budget",
      attemptedAt: "2026-08-31T10:00:00.000Z",
    });

    const row = resolveProofCaptureRefusal(skippedCapture);

    expect(row).not.toBeNull();
    expect(row!.kind).toBe("skipped_due_to_budget");
    expect(row!.reasonCode).toBe("skipped_due_to_budget");
    expect(row!.generatesAlert).toBe(false);
    // Human-friendly reason — no raw snake_case token reaches the customer.
    expect(row!.explanation).toMatch(/plan allowance reached/i);
    expect(formatRunHistoryRefusalCopy(row!)).toContain("No alert sent.");
    expect(formatRunHistoryRefusalCopy(row!)).not.toMatch(/skipped_due_to_budget/);
  });

  it("every budget skip over a 72h paid-tier window surfaces a run-history refusal row", () => {
    const WINDOW_START = Date.parse("2026-08-29T00:00:00.000Z");
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
      expect(row.reasonCode).toBe("skipped_due_to_budget");
      expect(row.generatesAlert).toBe(false);
      expect(formatRunHistoryRefusalCopy(row)).toContain("plan allowance reached");
      expect(formatRunHistoryRefusalCopy(row)).toContain("No alert sent.");
    }
  });

  it("the evidence card renders the budget-skip count, human reason, and a 'why this happened' link to /capture-rules#budget-skip", () => {
    const skips = Array.from({ length: 5 }, (_, index) =>
      capture({
        id: `proof-budget-${index}`,
        status: "skipped_due_to_budget",
        skipReason: "skipped_due_to_budget",
        attemptedAt: `2026-08-31T10:0${index}:00.000Z`,
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
        renderedAt: "2026-08-31T11:00:00.000Z",
        recentProofCaptures: skips,
        eventCandidates: [],
        events: [],
      },
      watchlistId: "watch-1",
    });

    // The count and human reason are visible.
    expect(markup).toContain("Skipped (plan allowance)");
    expect(markup).toContain("plan allowance was reached");
    // The "why this happened" link points at the budget-skip anchor.
    expect(markup).toContain("Why this happened");
    expect(markup).toContain(CAPTURE_BUDGET_SKIP_HREF);
    // No raw snake_case token leaks to the customer.
    expect(markup).not.toMatch(/skipped_due_to_budget/);
  });

  it("the evidence card does not render the budget-skip link when no budget skips occurred", () => {
    const markup = renderCard({
      checksExpanded: true,
      data: {
        proofSummary: { ...emptyProofSummary() },
        renderedAt: "2026-08-31T11:00:00.000Z",
        recentProofCaptures: [],
        eventCandidates: [],
        events: [],
      },
      watchlistId: "watch-1",
    });

    expect(markup).not.toContain("Why this happened");
    expect(markup).not.toContain(CAPTURE_BUDGET_SKIP_HREF);
  });

  it("/capture-rules renders the #budget-skip anchor with the public rule copy", () => {
    const routeSource = readFileSync("app/routes/capture-rules.tsx", "utf8");
    const rulesSource = readFileSync(
      "app/lib/capture-validity-public-rules.ts",
      "utf8",
    );

    // The route imports and renders the budget-skip rule (the title is
    // rendered via the JSX expression, so assert the import + the id the
    // route passes to PublicDocBlock, not a literal title string).
    expect(routeSource).toContain("CAPTURE_BUDGET_SKIP_PUBLIC_RULE");
    expect(routeSource).toContain("CAPTURE_BUDGET_SKIP_PUBLIC_RULE.id");

    // The anchor id is stable so the run-history link resolves.
    expect(CAPTURE_BUDGET_SKIP_ANCHOR).toBe("budget-skip");
    expect(CAPTURE_BUDGET_SKIP_PUBLIC_RULE.id).toBe("budget-skip");
    expect(CAPTURE_BUDGET_SKIP_HREF).toBe(`${CAPTURE_RULES_PUBLIC_PATH}#budget-skip`);

    // The public copy is sourced from the module the route renders, not a
    // hand-written copy that can drift.
    expect(rulesSource).toContain(CAPTURE_BUDGET_SKIP_PUBLIC_RULE.title);
    expect(rulesSource).toContain(CAPTURE_BUDGET_SKIP_PUBLIC_RULE.refused);
    expect(rulesSource).toContain(CAPTURE_BUDGET_SKIP_PUBLIC_RULE.why);
  });
});
