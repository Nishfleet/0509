import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { STORED_CAPTURE_NOTE } from "~/components/evidence/diff-plate";
import {
  EventChangesSection,
  buildQuietCheckItems,
  formatCaughtStamp,
  formatQuietCheckCopy,
  resolveEventDiffCaptures,
  resolvePriorProofCapture,
} from "~/components/watchlists/event-changes-section";
import type { ProofCaptureRecord, WatchEventRecord, WatchlistRunRecord } from "~/lib/types";

const event: WatchEventRecord = {
  id: "event-1",
  watchlistId: "watch-1",
  runId: "run-1",
  eventType: "landing_page_offer_changed",
  status: "confirmed",
  importanceScore: 84,
  adId: "ad-1",
  baselineFromRunId: "run-0",
  candidateId: "candidate-1",
  proofCaptureId: "proof-1",
  title: "Landing page offer changed",
  summary: "The landing-page offer changed.",
  metadata: {
    from: "Starting at ₹499",
    to: "Starting at ₹799",
  },
  confirmedAt: "2026-04-18T10:00:00.000Z",
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: "2026-04-18T10:00:00.000Z",
  createdAt: "2026-04-18T10:00:00.000Z",
};

const captures: ProofCaptureRecord[] = [
  {
    id: "proof-1",
    proofTargetId: "target-1",
    status: "succeeded",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: null,
    htmlArtifactKey: null,
    extractedFields: {},
    fieldConfidence: { priceText: 0.9 },
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "v1",
    idempotencyKey: "proof-1",
    attemptedAt: "2026-04-18T09:59:40.000Z",
    succeededAt: "2026-04-18T09:59:50.000Z",
    createdAt: "2026-04-18T09:59:50.000Z",
    updatedAt: "2026-04-18T09:59:50.000Z",
  },
  {
    id: "proof-0",
    proofTargetId: "target-1",
    status: "succeeded",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: null,
    htmlArtifactKey: null,
    extractedFields: {},
    fieldConfidence: { priceText: 0.88 },
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "v1",
    idempotencyKey: "proof-0",
    attemptedAt: "2026-04-17T09:59:40.000Z",
    succeededAt: "2026-04-17T09:59:50.000Z",
    createdAt: "2026-04-17T09:59:50.000Z",
    updatedAt: "2026-04-17T09:59:50.000Z",
  },
];

describe("event change feed helpers", () => {
  it("formats a caught stamp in UTC mono voice", () => {
    expect(formatCaughtStamp("2026-04-18T10:00:00.000Z")).toContain("CAUGHT 18 APR");
  });

  it("resolves the prior capture on the same proof target", () => {
    const current = captures[0];
    expect(resolvePriorProofCapture(current, captures)?.id).toBe("proof-0");
  });

  it("builds both diff panes from stored captures", () => {
    const diff = resolveEventDiffCaptures({
      event,
      proofCapture: captures[0],
      priorProofCapture: captures[1],
      runsById: new Map(),
    });

    expect(diff.before.capturedAt).toBe("2026-04-17T09:59:50.000Z");
    expect(diff.now.capturedAt).toBe("2026-04-18T09:59:50.000Z");
    expect(diff.before.value).toBe("Starting at ₹499");
    expect(diff.now.value).toBe("Starting at ₹799");
  });

  it("renders quiet checks as one dashed line each", () => {
    const run: WatchlistRunRecord = {
      id: "run-quiet",
      watchlistId: "watch-1",
      triggerType: "scheduled",
      status: "succeeded",
      pageBudget: 5,
      pagesScanned: 2,
      baselineFromRunId: null,
      summary: { eventsConfirmed: 0, adsSeen: 3 },
      startedAt: "2026-04-17T04:00:00.000Z",
      finishedAt: "2026-04-17T04:01:00.000Z",
      errorCode: null,
      errorMessage: null,
    };

    expect(formatQuietCheckCopy(run)).toContain("Checked.");
    expect(buildQuietCheckItems([run])).toHaveLength(1);
  });

  it("keeps in-flight runs visible on the evidence tab", () => {
    const running: WatchlistRunRecord = {
      id: "run-live",
      watchlistId: "watch-1",
      triggerType: "scheduled",
      status: "running",
      pageBudget: 5,
      pagesScanned: 0,
      baselineFromRunId: null,
      summary: {},
      startedAt: "2026-04-17T04:00:00.000Z",
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
    };

    expect(formatQuietCheckCopy(running)).toBe("Still running");
    expect(buildQuietCheckItems([running])).toHaveLength(1);
  });
});

function renderChangeFeed(markupProps: Parameters<typeof EventChangesSection>[0]) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: createElement(EventChangesSection, markupProps),
    },
  ]);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("EventChangesSection", () => {
  it("renders a diff plate with both capture timestamps and the honesty note", () => {
    const markup = renderChangeFeed({
      checksExpanded: false,
      data: {
        events: [event],
        runs: [],
        selectedWatchlist: {
          id: "watch-1",
          name: "Nykaa watch",
          lastScannedAt: "2026-04-18T09:00:00.000Z",
        },
        plan: "starter",
        effectiveDeliveryConfig: { timezone: "UTC" },
        highlightedEventId: null,
      },
      lastAttemptByEventId: new Map(),
      proofCapturesById: new Map(captures.map((capture) => [capture.id, capture])),
      recentProofCaptures: captures,
      renderedAt: new Date("2026-04-18T10:59:50.000Z"),
      sourceCanSchedule: true,
      watchlistId: "watch-1",
    });

    expect(markup).toContain("f9-ed-diff-plate");
    expect(markup).toContain("17 Apr 2026, 09:59 UTC");
    expect(markup).toContain("18 Apr 2026, 09:59 UTC");
    expect(markup).toContain(STORED_CAPTURE_NOTE);
    expect(markup).not.toContain("Insight depth");
  });
});
