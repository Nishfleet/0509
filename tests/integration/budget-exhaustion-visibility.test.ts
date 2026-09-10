import { describe, expect, it } from "vitest";

import { buildDigestEmail } from "~/lib/digest-email.server";
import {
  buildRunHistoryRefusalRows,
  formatRunHistoryRefusalCopy,
  resolveProofCaptureRefusal,
  type RunHistoryRefusalRow,
} from "~/lib/run-history-capture-visibility";
import type { ProofCaptureRecord } from "~/lib/types";
import { classifyWatchPeriodTriage } from "~/lib/watch-period-triage";

/**
 * Issue #1879 (Q3): a paid-tier watchlist whose monthly proof-capture budget
 * is exhausted must never fail silently. This is the user-visible-surface
 * guard for the three places a budget skip is required to show up:
 *
 *   1. Run history (/app/watchlists/:id): a `skipped_due_to_budget` capture
 *      renders as a `Budget exhausted` row with a human reason — never as a
 *      raw snake_case token.
 *   2. Period triage: the 72h window reads `evidence_skipped_budget` (never
 *      `all_quiet`) and carries how many watched competitors hit the limit.
 *   3. Digest email: an `evidence_skipped_budget` period gets a one-line
 *      footer: "Note: N competitors hit the monthly proof-capture limit."
 *
 * The verify command in the issue targets this exact path on the `node`
 * vitest project. Real-D1 retrieval of budget-skip rows is proven separately
 * by `tests/integration/proof-capture-budget.integration.test.ts` (#1857) and
 * `tests/integration/watchlist-run-capture-attempts.integration.test.ts`
 * (#1289); this file is the shared surfacing contract every surface reads.
 */

const WINDOW_START = "2026-08-25T00:00:00.000Z";
const HOUR = 60 * 60 * 1000;

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
    attemptedAt: WINDOW_START,
    succeededAt: null,
    createdAt: WINDOW_START,
    updatedAt: WINDOW_START,
    ...overrides,
  };
}

function budgetSkipAt(hoursIntoWindow: number, watchlistId = "watch-paid-1"): ProofCaptureRecord {
  return capture({
    id: `proof-budget-${watchlistId}-${hoursIntoWindow}`,
    status: "skipped_due_to_budget",
    skipReason: "skipped_due_to_budget",
    attemptedAt: new Date(Date.parse(WINDOW_START) + hoursIntoWindow * HOUR).toISOString(),
  });
}

function expectVisibleBudgetRow(row: RunHistoryRefusalRow) {
  expect(row.kind).toBe("skipped_due_to_budget");
  expect(row.reasonCode).toBe("skipped_due_to_budget");
  // Label is budget-exhausted specific, never the generic "Skipped".
  expect(row.label).toBe("Budget exhausted");
  // Human reason — no raw machine token reaches the customer.
  expect(row.explanation).toMatch(/plan allowance reached/i);
  expect(row.explanation).toMatch(/resets on your next plan cycle/i);
  expect(row.generatesAlert).toBe(false);
  const copy = formatRunHistoryRefusalCopy(row);
  expect(copy).toContain("No alert sent.");
  expect(copy).not.toMatch(/skipped_due_to_budget/);
}

describe("budget-exhaustion visibility (#1879)", () => {
  it("surfaces every budget skip as a visible 'Budget exhausted' run-history row, never an alert", () => {
    const skips = Array.from({ length: 8 }, (_, index) => budgetSkipAt(index * 9));
    const rows = buildRunHistoryRefusalRows({ captures: skips });

    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expectVisibleBudgetRow(row);
    }
  });

  it("does not silently swallow a single paid-tier budget skip: one drop is one visible row", () => {
    const row = resolveProofCaptureRefusal(
      budgetSkipAt(0),
    );
    expect(row).not.toBeNull();
    expectVisibleBudgetRow(row!);
  });

  it("classifies the 72h budget-exhausted period as evidence_skipped_budget with the competitor count", () => {
    // Two paid-tier competitors both hit the budget over the window.
    const skips = [
      budgetSkipAt(0, "watch-paid-a"),
      budgetSkipAt(6, "watch-paid-a"),
      budgetSkipAt(12, "watch-paid-a"),
      budgetSkipAt(24, "watch-paid-b"),
      budgetSkipAt(36, "watch-paid-b"),
    ];
    const triage = classifyWatchPeriodTriage({
      events: [],
      candidates: [],
      proofCaptures: skips.map(({ status }, index) => ({
        status,
        watchlistId: index < 3 ? "watch-paid-a" : "watch-paid-b",
      })),
      successfulRuns: 5,
      lastSuccessfulCheckAt: skips[skips.length - 1]!.attemptedAt,
    });

    expect(triage.status).toBe("evidence_skipped_budget");
    expect(triage.status).not.toBe("all_quiet");
    expect(triage.explanation).toContain("5 checks were skipped");
    expect(triage.explanation).toContain("plan's evidence allowance was reached");
    expect(triage.budgetSkippedCompetitorCount).toBe(2);
  });

  it("digest email: an evidence_skipped_budget period renders the budget-limit footer", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-08-25T00:00:00.000Z",
      periodEnd: "2026-08-28T00:00:00.000Z",
      cadence: "weekly",
      timeZone: "Asia/Kolkata",
      fullDigestUrl: "https://0509.io/app/digests",
      baseUrl: "https://0509.io",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: "https://0509.io/unsubscribe?sig=test",
      items: [],
      heartbeat: {
        runs: 5,
        watchlistsChecked: 2,
        adsSeen: 0,
        triage: {
          status: "evidence_skipped_budget",
          label: "Some checks skipped — plan allowance reached",
          explanation:
            "5 checks were skipped because your plan's evidence allowance was reached, so those competitors were not re-checked this period.",
          checkedAt: "2026-08-28T00:00:00.000Z",
          checksCompleted: 5,
          suppressedChanges: 0,
          suppressionReasons: [],
          nextAction:
            "Checks resume when the allowance resets. Add a credit pack or upgrade the plan to capture more now.",
          noActionLine: "Nothing new was confirmed this period",
          budgetSkippedCompetitorCount: 2,
        },
      },
    });

    expect(email.subject).toContain("plan allowance reached");
    expect(email.html).toContain(
      "Note: 2 competitors hit the monthly proof-capture limit.",
    );
    expect(email.text).toContain(
      "Note: 2 competitors hit the monthly proof-capture limit.",
    );
    // The customer never sees the raw machine status.
    expect(email.html).not.toMatch(/skipped_due_to_budget/);
    expect(email.text).not.toMatch(/skipped_due_to_budget/);
  });

  it("digest email: no budget footer when the period had no budget skip reason with a count", () => {
    const email = buildDigestEmail({
      name: "Owner",
      periodStart: "2026-08-25T00:00:00.000Z",
      periodEnd: "2026-08-28T00:00:00.000Z",
      fullDigestUrl: "https://0509.io/app/digests",
      baseUrl: "https://0509.io",
      manageFrequencyUrl: "https://0509.io/app/notifications",
      supportEmail: "support@0509.io",
      supportMailto: "mailto:support@0509.io",
      unsubscribeUrl: "https://0509.io/unsubscribe?sig=test",
      items: [
        {
          watchlistId: "watch-a",
          watchlistName: "Nykaa",
          eventType: "landing_page_headline_changed",
          title: "Headline changed",
          summary: "Headline moved.",
          metadata: { kind: "landing_page_headline_changed" },
        },
      ],
    });

    expect(email.html).not.toContain("monthly proof-capture limit");
    expect(email.text).not.toContain("monthly proof-capture limit");
  });
});
