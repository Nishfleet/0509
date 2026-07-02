import { describe, expect, it } from "vitest";

import {
  classifyDigestItemSource,
  classifyWatchEventSource,
  filterClientReportWatchEvents,
  proofMixLabel,
  summarizeDigestProofMix,
} from "~/lib/proof-classification";
import type { WatchEventRecord } from "~/lib/types";

const baseEvent: WatchEventRecord = {
  id: "event-1",
  watchlistId: "watch-1",
  runId: "run-1",
  eventType: "ad_new",
  status: "confirmed",
  importanceScore: 80,
  adId: "meta-1",
  baselineFromRunId: null,
  candidateId: "candidate-1",
  proofCaptureId: "proof-1",
  title: "New ad detected",
  summary: "A new ad appeared.",
  metadata: {},
  confirmedAt: "2026-06-01T00:00:00.000Z",
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: "2026-06-01T00:00:00.000Z",
  createdAt: "2026-06-01T00:00:00.000Z",
};

describe("proof classification", () => {
  it("labels digest items without calling scan-spotted proof-backed", () => {
    expect(
      classifyDigestItemSource({
        watchlistName: "Nykaa",
        eventType: "ad_new",
        title: "New ad",
        summary: "New ad appeared.",
        metadata: { sourceStatus: "scan_backed", priorityScore: 70 },
        createdAt: "2026-06-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      status: "scan_spotted",
      label: "Check-spotted",
      sourceTypeLabel: "Scheduled check",
    });

    expect(
      summarizeDigestProofMix([
        { metadata: { sourceStatus: "proof_backed", proofCaptureId: "proof-1" } },
        { metadata: { sourceStatus: "scan_backed" } },
        { metadata: { eventStatus: "proof_pending", sourceStatus: "scan_backed" } },
        { metadata: { status: "proof_failed" } },
      ]),
    ).toMatchObject({
      verifiedProof: 1,
      scanSpotted: 1,
      proofPending: 1,
      proofFailed: 1,
    });
  });

  it("preserves generated digest event status for provisional customer digests", () => {
    expect(
      classifyDigestItemSource({
        metadata: {
          eventStatus: "proof_pending",
          sourceStatus: "scan_backed",
        },
      }),
    ).toMatchObject({
      status: "proof_pending",
      label: "Evidence unavailable",
    });
    expect(
      classifyDigestItemSource({
        metadata: {
          eventStatus: "detected",
          sourceStatus: "scan_backed",
        },
      }),
    ).toMatchObject({
      status: "needs_review",
      label: "Needs review",
    });
  });

  it("honors stored snapshot proof status when metadata has been sanitized", () => {
    expect(
      classifyDigestItemSource({
        proofStatus: "canary_or_test",
        metadata: {
          eventStatus: "confirmed",
          sourceStatus: "proof_backed",
          priorityScore: 99,
        },
      }),
    ).toMatchObject({
      status: "canary_or_test",
      label: "Excluded from client report",
    });
  });

  it("uses customer-facing evidence labels for unavailable and excluded statuses", () => {
    expect(
      classifyDigestItemSource({
        metadata: { eventStatus: "proof_pending", sourceStatus: "scan_backed" },
      }),
    ).toMatchObject({
      status: "proof_pending",
      label: "Evidence unavailable",
      sourceTypeLabel: "Scheduled check",
    });

    expect(
      classifyDigestItemSource({
        metadata: { status: "proof_failed" },
      }),
    ).toMatchObject({
      status: "proof_failed",
      label: "Evidence unavailable",
      sourceTypeLabel: "Source unavailable",
    });

    expect(classifyDigestItemSource({ metadata: {} })).toMatchObject({
      status: "unknown",
      label: "Evidence unavailable",
      sourceTypeLabel: "Source unavailable",
    });

    expect(
      classifyWatchEventSource({
        ...baseEvent,
        status: "invalidated",
        invalidatedAt: "2026-06-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      status: "invalidated",
      label: "Excluded from client report",
      sourceTypeLabel: "Source unavailable",
    });

    expect(
      classifyWatchEventSource({
        ...baseEvent,
        status: "suppressed",
        suppressedAt: "2026-06-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      status: "suppressed",
      label: "Excluded from client report",
      sourceTypeLabel: "Source unavailable",
    });
  });

  it("summarizes unavailable proof without exposing pipeline status names", () => {
    const label = proofMixLabel(
      summarizeDigestProofMix([
        { metadata: { eventStatus: "proof_pending", sourceStatus: "scan_backed" } },
        { metadata: { status: "proof_failed" } },
        { metadata: {} },
        { metadata: { kind: "launch_readiness_canary" } },
      ]),
    );

    expect(label).toBe("3 evidence unavailable · 1 excluded from client report");
    expect(label).not.toContain("proof pending");
    expect(label).not.toContain("proof failed");
    expect(label).not.toContain("unknown");
  });

  it("filters client reports to verified proof by default", () => {
    const scanOnly = {
      ...baseEvent,
      id: "event-scan",
      proofCaptureId: null,
      metadata: { sourceStatus: "scan_backed" },
    };
    const metadataOnlyProof = {
      ...baseEvent,
      id: "event-metadata-proof",
      proofCaptureId: null,
      metadata: { sourceStatus: "proof_backed" },
    };
    const suppressed = {
      ...baseEvent,
      id: "event-suppressed",
      status: "suppressed" as const,
      suppressedAt: "2026-06-01T00:00:00.000Z",
    };
    const canary = {
      ...baseEvent,
      id: "event-canary",
      metadata: { kind: "launch_readiness_canary" },
    };

    const result = filterClientReportWatchEvents([
      baseEvent,
      scanOnly,
      metadataOnlyProof,
      suppressed,
      canary,
    ]);

    expect(result.eligibleEvents.map((event) => event.id)).toEqual(["event-1"]);
    expect(result.sourceCoverage).toMatchObject({
      totalInput: 5,
      included: 1,
      excluded: 4,
    });
    expect(classifyWatchEventSource(metadataOnlyProof).status).toBe("scan_spotted");
    expect(classifyWatchEventSource(canary).status).toBe("canary_or_test");
  });

  it("covers report eligibility edge statuses", () => {
    const invalidated = {
      ...baseEvent,
      status: "invalidated" as const,
      invalidatedAt: "2026-06-01T00:00:00.000Z",
    };
    const internal = {
      ...baseEvent,
      metadata: { internalOnly: true },
    };
    const pending = {
      ...baseEvent,
      proofCaptureId: null,
      status: "proof_pending" as const,
      metadata: { sourceStatus: "scan_backed" },
    };
    const detected = {
      ...baseEvent,
      proofCaptureId: null,
      status: "detected" as const,
      metadata: { sourceStatus: "scan_backed" },
    };
    const unknown = {
      ...baseEvent,
      proofCaptureId: null,
      status: "confirmed" as const,
      metadata: {},
    };

    expect(classifyWatchEventSource(invalidated).status).toBe("invalidated");
    expect(classifyWatchEventSource(internal).status).toBe("internal_only");
    expect(classifyWatchEventSource(pending).status).toBe("proof_pending");
    expect(classifyWatchEventSource(detected).status).toBe("needs_review");
    expect(classifyDigestItemSource({ metadata: {} }).status).toBe("unknown");
    expect(classifyWatchEventSource(unknown).status).toBe("scan_spotted");

    expect(filterClientReportWatchEvents([baseEvent, unknown]).eligibleEvents).toHaveLength(1);
    expect(
      filterClientReportWatchEvents([baseEvent, unknown], { allowScanSpotted: true }).eligibleEvents,
    ).toHaveLength(2);
  });
});
