import { describe, expect, it } from "vitest";

import {
  canClaimQuiet,
  canRenderVerifiedDiff,
  countsAsConfirmedMove,
  isAuditOnly,
  resolveCustomerEvidenceState,
} from "~/lib/evidence-render-contract";
import type { ProofCaptureRecord, WatchEventRecord } from "~/lib/types";

function event(status: WatchEventRecord["status"]): WatchEventRecord {
  return {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_url_changed",
    status,
    importanceScore: 70,
    adId: null,
    baselineFromRunId: null,
    candidateId: null,
    proofCaptureId: "proof-1",
    title: "Price changed",
    summary: "Hero price dropped.",
    metadata: {},
    confirmedAt: status === "confirmed" ? "2026-07-15T00:00:00.000Z" : null,
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-07-15T00:00:00.000Z",
    createdAt: "2026-07-15T00:00:00.000Z",
  };
}

const succeededCapture = { status: "succeeded" } as ProofCaptureRecord;
const failedCapture = { status: "failed" } as ProofCaptureRecord;

describe("the customer evidence render contract", () => {
  it("only a confirmed event with a succeeded capture and ordered pair is a verified change", () => {
    expect(
      resolveCustomerEvidenceState({
        event: event("confirmed"),
        proofCapture: succeededCapture,
        beforeCapturedAt: "2026-07-14T00:00:00.000Z",
        nowCapturedAt: "2026-07-15T00:00:00.000Z",
      }),
    ).toBe("verified_change");
  });

  it("a confirmed event with a mis-ordered pair degrades to provisional", () => {
    expect(
      resolveCustomerEvidenceState({
        event: event("confirmed"),
        proofCapture: succeededCapture,
        beforeCapturedAt: "2026-07-16T00:00:00.000Z",
        nowCapturedAt: "2026-07-15T00:00:00.000Z",
      }),
    ).toBe("provisional_signal");
  });

  it("a confirmed event with a failed capture degrades to provisional", () => {
    expect(
      resolveCustomerEvidenceState({
        event: event("confirmed"),
        proofCapture: failedCapture,
        beforeCapturedAt: "2026-07-14T00:00:00.000Z",
        nowCapturedAt: "2026-07-15T00:00:00.000Z",
      }),
    ).toBe("provisional_signal");
  });

  it("fails closed: a confirmed event with NO capture presented is provisional, never verified", () => {
    expect(
      resolveCustomerEvidenceState({
        event: event("confirmed"),
        proofCapture: null,
        beforeCapturedAt: "2026-07-14T00:00:00.000Z",
        nowCapturedAt: "2026-07-15T00:00:00.000Z",
      }),
    ).toBe("provisional_signal");
  });

  it("fails closed: missing timestamps are absent evidence, not satisfied evidence", () => {
    expect(
      resolveCustomerEvidenceState({
        event: event("confirmed"),
        proofCapture: succeededCapture,
        beforeCapturedAt: null,
        nowCapturedAt: null,
      }),
    ).toBe("provisional_signal");
  });

  it("detected and proof_pending are provisional; they never count or verify", () => {
    for (const status of ["detected", "proof_pending"] as const) {
      const state = resolveCustomerEvidenceState({
        event: event(status),
        proofCapture: succeededCapture,
        beforeCapturedAt: "2026-07-14T00:00:00.000Z",
        nowCapturedAt: "2026-07-15T00:00:00.000Z",
      });
      expect(state).toBe("provisional_signal");
      expect(canRenderVerifiedDiff(state)).toBe(false);
      expect(countsAsConfirmedMove(state)).toBe(false);
    }
  });

  it("suppressed and invalidated are audit-only", () => {
    for (const status of ["suppressed", "invalidated"] as const) {
      const state = resolveCustomerEvidenceState({
        event: event(status),
        proofCapture: succeededCapture,
        beforeCapturedAt: "2026-07-14T00:00:00.000Z",
        nowCapturedAt: "2026-07-15T00:00:00.000Z",
      });
      expect(isAuditOnly(state)).toBe(true);
      expect(canRenderVerifiedDiff(state)).toBe(false);
    }
  });

  it("a failed check can never claim quiet", () => {
    expect(
      canClaimQuiet(
        resolveCustomerEvidenceState({
          event: event("proof_failed"),
          proofCapture: null,
          beforeCapturedAt: null,
          nowCapturedAt: null,
        }),
      ),
    ).toBe(false);
  });

  it("a provisional signal can never claim quiet either — something might have changed", () => {
    expect(
      canClaimQuiet(
        resolveCustomerEvidenceState({
          event: event("detected"),
          proofCapture: null,
          beforeCapturedAt: null,
          nowCapturedAt: null,
        }),
      ),
    ).toBe(false);
  });
});
