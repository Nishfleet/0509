import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RecentEvidenceChecksCard } from "~/components/watchlists/recent-evidence-checks-card";
import type { ProofCaptureRecord, WatchlistProofSummary } from "~/lib/types";
import {
  buildProofSummary,
  formatProofSkipReason,
} from "~/lib/watchlist-display";

function proofCapture(
  status: ProofCaptureRecord["status"],
): ProofCaptureRecord {
  return {
    id: `proof-${status}`,
    proofTargetId: "target-1",
    status,
    skipReason: status.startsWith("skipped_")
      ? (status as ProofCaptureRecord["skipReason"])
      : null,
    failureCode: status === "failed" ? "proof_capture_failed" : null,
    failureReason: status === "failed" ? "Landing-page proof capture failed." : null,
    screenshotArtifactKey: null,
    htmlArtifactKey: null,
    extractedFields: {},
    fieldConfidence: {},
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: `proof-request:${status}`,
    attemptedAt: "2026-08-26T09:59:40.000Z",
    succeededAt: status === "succeeded" ? "2026-08-26T09:59:50.000Z" : null,
    createdAt: "2026-08-26T09:59:50.000Z",
    updatedAt: "2026-08-26T09:59:50.000Z",
  };
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("buildProofSummary skip-reason counts (Q3 #958)", () => {
  it("splits the 70 budget skips out of a mixed capture list", () => {
    const captures = [
      ...Array.from({ length: 70 }, () => proofCapture("skipped_due_to_budget")),
      proofCapture("skipped_due_to_rate_limit"),
      proofCapture("skipped_due_to_dedupe"),
      proofCapture("succeeded"),
      proofCapture("failed"),
    ];

    expect(buildProofSummary(captures)).toMatchObject({
      totalAttempts: 74,
      successfulAttempts: 1,
      failedAttempts: 1,
      skippedAttempts: 72,
      skippedDueToBudget: 70,
      skippedDueToRateLimit: 1,
      skippedDueToDedupe: 1,
    });
  });
});

describe("formatProofSkipReason (Q3 #958)", () => {
  it("returns a user-visible reason for every skip status and nothing else", () => {
    expect(formatProofSkipReason("skipped_due_to_budget")).toBe(
      "Skipped — plan allowance reached. Checks resume when your allowance resets.",
    );
    expect(formatProofSkipReason("skipped_due_to_rate_limit")).toBe(
      "Skipped — source rate limited. The next scheduled run retries.",
    );
    expect(formatProofSkipReason("skipped_due_to_dedupe")).toBe(
      "Skipped — duplicate of a recent check.",
    );
    expect(formatProofSkipReason("succeeded")).toBeNull();
    expect(formatProofSkipReason("failed")).toBeNull();
    expect(formatProofSkipReason("pending")).toBeNull();
  });
});

describe("RecentEvidenceChecksCard (Q3 #958)", () => {
  const summary: WatchlistProofSummary = {
    totalAttempts: 73,
    successfulAttempts: 3,
    failedAttempts: 0,
    skippedAttempts: 70,
    skippedDueToBudget: 70,
    skippedDueToRateLimit: 0,
    skippedDueToDedupe: 0,
    lastAttemptAt: "2026-08-26T09:59:40.000Z",
    lastSuccessfulProofAt: "2026-08-26T09:59:50.000Z",
  };

  it("shows the plan-allowance reason instead of a silent skipped count", () => {
    const html = render(
      <RecentEvidenceChecksCard
        data={{
          proofSummary: summary,
          renderedAt: "2026-08-26T12:00:00.000Z",
          recentProofCaptures: [proofCapture("skipped_due_to_budget")],
        }}
      />,
    );

    expect(html).toContain("Skipped (plan allowance)");
    expect(html).toContain(">70<");
    expect(html).toContain("plan allowance was reached");
    expect(html).toContain("plan allowance reached");
    expect(html).not.toContain("skipped_due_to_budget");
  });
});
