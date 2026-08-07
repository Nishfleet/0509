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
      resolveCustomerEvidenceState({ event: event("confirmed"), proofCapture: failedCapture }),
    ).toBe("provisional_signal");
  });

  it("detected and proof_pending are provisional; they never count or verify", () => {
    for (const status of ["detected", "proof_pending"] as const) {
      const state = resolveCustomerEvidenceState({ event: event(status) });
      expect(state).toBe("provisional_signal");
      expect(canRenderVerifiedDiff(state)).toBe(false);
      expect(countsAsConfirmedMove(state)).toBe(false);
    }
  });

  it("suppressed and invalidated are audit-only", () => {
    expect(isAuditOnly(resolveCustomerEvidenceState({ event: event("suppressed") }))).toBe(true);
    expect(isAuditOnly(resolveCustomerEvidenceState({ event: event("invalidated") }))).toBe(true);
  });

  it("a failed check can never claim quiet", () => {
    expect(canClaimQuiet(resolveCustomerEvidenceState({ event: event("proof_failed") }))).toBe(
      false,
    );
  });
});
