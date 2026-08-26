import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RecentEvidenceChecksCard } from "~/components/watchlists/recent-evidence-checks-card";
import type { CaptureValidityReasonCode } from "~/lib/capture-validity.server";
import { isCustomerDigestEligibleEvent } from "~/lib/delivery-policy.server";
import {
  buildRunHistoryRefusalRows,
  formatRunHistoryRefusalCopy,
  resolveProofCaptureRefusal,
  resolveSuppressedCandidateRefusal,
  type RunHistoryRefusalRow,
} from "~/lib/run-history-capture-visibility";
import { formatLandingPageCaptureGap } from "~/lib/search-display";
import type {
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
} from "~/lib/types";
import { emptyProofSummary } from "~/lib/watchlist-display";

/**
 * BET 4 Part 2 (#969): every fixture-suite failure mode appears in run
 * history with its reason, and none of them generate an alert.
 */

const GATE_FAILURE_MODES: Array<{
  label: string;
  reasonCode: CaptureValidityReasonCode;
}> = [
  { label: "500 error page", reasonCode: "landing_error_page" },
  { label: "Cloudflare challenge", reasonCode: "landing_challenge_page" },
  { label: "cookie / consent wall", reasonCode: "landing_cookie_wall" },
  { label: "partial SPA shell", reasonCode: "landing_partial_spa" },
  { label: "site down (maintenance)", reasonCode: "landing_error_page" },
  {
    label: "content signature too small",
    reasonCode: "landing_content_signature_too_small",
  },
];

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

function candidate(
  overrides: Partial<EventCandidateRecord> & Pick<EventCandidateRecord, "id" | "status">,
): EventCandidateRecord {
  return {
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_headline_changed",
    importanceScore: 70,
    adId: "ad-1",
    proofTargetId: "target-1",
    title: "Headline changed",
    summary: "The landing-page headline changed.",
    metadata: {},
    proofRequired: true,
    skipReason: null,
    dedupeReason: null,
    detectedAt: "2026-08-25T10:00:00.000Z",
    lastEvaluatedAt: "2026-08-25T10:00:00.000Z",
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

function suppressedEvent(overrides: Partial<WatchEventRecord> = {}): WatchEventRecord {
  return {
    id: "event-suppressed",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_headline_changed",
    status: "suppressed",
    importanceScore: 80,
    adId: "ad-1",
    baselineFromRunId: "run-0",
    candidateId: "candidate-suppressed",
    proofCaptureId: "proof-1",
    title: "Headline changed",
    summary: "The landing-page headline changed.",
    metadata: { corroboration: "unconfirmed_by_screenshot" },
    confirmedAt: null,
    suppressedAt: "2026-08-25T10:00:00.000Z",
    invalidatedAt: null,
    lastEvaluatedAt: "2026-08-25T10:00:00.000Z",
    createdAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

function expectNoAlert(row: RunHistoryRefusalRow) {
  expect(row.generatesAlert).toBe(false);
  expect(formatRunHistoryRefusalCopy(row)).toContain("No alert sent.");
  expect(formatRunHistoryRefusalCopy(row)).not.toMatch(/_[a-z]/);
}

describe("run-history capture visibility (#969)", () => {
  describe("fixture-suite failure modes appear with their reason", () => {
    for (const fixture of GATE_FAILURE_MODES) {
      it(`records capture_failed for ${fixture.label} and never alerts`, () => {
        const row = resolveProofCaptureRefusal(
          capture({
            id: `proof-${fixture.reasonCode}`,
            status: "failed",
            failureCode: fixture.reasonCode,
            failureReason: "Capture-validity gate rejected the page.",
          }),
        );

        expect(row).not.toBeNull();
        expect(row!.kind).toBe("capture_failed");
        expect(row!.reasonCode).toBe(fixture.reasonCode);
        expect(row!.explanation).toBe(
          formatLandingPageCaptureGap(fixture.reasonCode).proofLabel,
        );
        expectNoAlert(row!);
      });
    }

    it("records skipped_due_to_budget with its reason and never alerts", () => {
      const row = resolveProofCaptureRefusal(
        capture({
          id: "proof-budget",
          status: "skipped_due_to_budget",
          skipReason: "skipped_due_to_budget",
        }),
      );

      expect(row).not.toBeNull();
      expect(row!.kind).toBe("skipped_due_to_budget");
      expect(row!.reasonCode).toBe("skipped_due_to_budget");
      expect(row!.explanation).toMatch(/plan allowance reached/i);
      expectNoAlert(row!);
    });

    it("records suppressed_proof_duplicate from a candidate and never alerts", () => {
      const row = resolveSuppressedCandidateRefusal(
        candidate({
          id: "candidate-dup",
          status: "suppressed",
          dedupeReason: "proof_duplicate",
        }),
      );

      expect(row).not.toBeNull();
      expect(row!.kind).toBe("suppressed_proof_duplicate");
      expect(row!.reasonCode).toBe("proof_duplicate");
      expect(row!.explanation).toMatch(/already recorded/i);
      expectNoAlert(row!);
    });

    it("records suppressed_unconfirmed_by_screenshot and never alerts", () => {
      const row = resolveSuppressedCandidateRefusal(
        candidate({
          id: "candidate-shot",
          status: "suppressed",
          metadata: { corroboration: "unconfirmed_by_screenshot" },
        }),
      );

      expect(row).not.toBeNull();
      expect(row!.kind).toBe("suppressed_unconfirmed_by_screenshot");
      expectNoAlert(row!);
    });
  });

  it("does not list a succeeded capture or a confirmed change as a refusal", () => {
    const rows = buildRunHistoryRefusalRows({
      captures: [
        capture({
          id: "proof-ok",
          status: "succeeded",
          succeededAt: "2026-08-25T10:00:01.000Z",
        }),
      ],
      events: [
        {
          ...suppressedEvent({ id: "event-confirmed", status: "confirmed" }),
          confirmedAt: "2026-08-25T10:00:01.000Z",
          suppressedAt: null,
          metadata: { from: "Starting at ₹499", to: "Starting at ₹799" },
        },
      ],
    });

    expect(rows).toEqual([]);
  });

  it("a suppressed watch event is not customer-digest or instant-alert eligible", () => {
    const event = suppressedEvent();
    expect(isCustomerDigestEligibleEvent(event)).toBe(false);
    const row = buildRunHistoryRefusalRows({ events: [event] })[0];
    expect(row?.kind).toBe("suppressed_unconfirmed_by_screenshot");
    expectNoAlert(row!);
  });

  it("renders each refusal as an explained run-history row", () => {
    const captures = GATE_FAILURE_MODES.map((fixture, index) =>
      capture({
        id: `proof-${index}`,
        status: "failed",
        failureCode: fixture.reasonCode,
        attemptedAt: `2026-08-25T10:0${index}:00.000Z`,
      }),
    );
    captures.push(
      capture({
        id: "proof-budget",
        status: "skipped_due_to_budget",
        skipReason: "skipped_due_to_budget",
        attemptedAt: "2026-08-25T10:09:00.000Z",
      }),
    );
    const candidates = [
      candidate({
        id: "candidate-dup",
        status: "suppressed",
        dedupeReason: "proof_duplicate",
        detectedAt: "2026-08-25T10:10:00.000Z",
      }),
    ];

    const markup = renderToStaticMarkup(
      createElement(RecentEvidenceChecksCard, {
        checksExpanded: true,
        data: {
          proofSummary: {
            ...emptyProofSummary(),
            totalAttempts: captures.length,
            failedAttempts: GATE_FAILURE_MODES.length,
            skippedAttempts: 1,
          },
          renderedAt: "2026-08-25T11:00:00.000Z",
          recentProofCaptures: captures,
          eventCandidates: candidates,
          events: [],
        },
        watchlistId: "watch-1",
      }),
    );

    expect(markup).toContain("What we did not alert on");
    expect(markup).toContain("No alert sent.");
    for (const fixture of GATE_FAILURE_MODES) {
      expect(markup).toContain(formatLandingPageCaptureGap(fixture.reasonCode).proofLabel);
    }
    expect(markup).toContain("plan allowance reached");
    expect(markup).toContain("Same change already recorded");
    expect(markup).not.toMatch(/capture_failed|skipped_due_to_budget|suppressed_proof_duplicate/);
  });
});
