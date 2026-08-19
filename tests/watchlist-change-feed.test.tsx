import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { DIFF_PLATE_DEGRADE_COPY, STORED_CAPTURE_NOTE } from "~/components/evidence/diff-plate";
import {
  EVENT_CHANGE_AD_NEW_COPY,
  EVENT_CHANGE_SUPPRESSED_COPY,
  EVENT_DELIVERY_NONE_COPY,
  EventChangesSection,
  buildQuietCheckItems,
  canRenderEventDiffPlate,
  formatCaughtStamp,
  formatEventChangeWhy,
  formatEventDeliveryLine,
  formatPlateVerification,
  EVENT_CHANGE_UNVERIFIED_COPY,
  formatQuietCheckCopy,
  hasStoredDiffFieldValues,
  resolveEventChangeQuietCopy,
  resolveEventDiffCaptures,
  resolvePriorProofCapture,
} from "~/components/watchlists/event-changes-section";
import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import type { PublicDeliveryAttemptSummary } from "~/lib/delivery-attempt-public";
import type { ProofCaptureRecord, WatchEventRecord, WatchlistRunRecord } from "~/lib/types";

const offerEvent: WatchEventRecord = {
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
    proofTrail: "Verified from a page snapshot",
  },
  confirmedAt: "2026-04-18T10:00:00.000Z",
  suppressedAt: null,
  invalidatedAt: null,
  lastEvaluatedAt: "2026-04-18T10:00:00.000Z",
  createdAt: "2026-04-18T10:00:00.000Z",
};

const adNewEvent: WatchEventRecord = {
  ...offerEvent,
  id: "event-ad-new",
  eventType: "ad_new",
  proofCaptureId: null,
  title: "New ad detected",
  summary: "A new ad appeared on this watchlist.",
  metadata: {
    kind: "ad_new",
    recommendedAction: "Review the new creative.",
  },
};

const suppressedEvent: WatchEventRecord = {
  ...offerEvent,
  id: "event-suppressed",
  eventType: "ad_inactive",
  status: "suppressed",
  proofCaptureId: null,
  title: "Suppressed low-signal change",
  summary: "Fixture suppressed item should not dominate trust views.",
  metadata: { source: "scan_spotted" },
  confirmedAt: null,
  suppressedAt: "2026-04-18T10:01:00.000Z",
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

const baselineRun: WatchlistRunRecord = {
  id: "run-0",
  watchlistId: "watch-1",
  triggerType: "scheduled",
  status: "succeeded",
  pageBudget: 3,
  pagesScanned: 1,
  baselineFromRunId: null,
  summary: {},
  startedAt: "2026-04-17T04:00:00.000Z",
  finishedAt: "2026-04-17T04:01:00.000Z",
  errorCode: null,
  errorMessage: null,
};

describe("event change feed helpers", () => {
  it("formats a caught stamp in UTC mono voice", () => {
    expect(formatCaughtStamp("2026-04-18T10:00:00.000Z")).toContain("CAUGHT 18 APR");
  });

  it("resolves the prior capture on the same proof target", () => {
    const current = captures[0];
    expect(resolvePriorProofCapture(current, captures)?.id).toBe("proof-0");
  });

  it("builds both diff panes from stored captures and metadata from/to only", () => {
    const diff = resolveEventDiffCaptures({
      event: offerEvent,
      proofCapture: captures[0],
      priorProofCapture: captures[1],
      runsById: new Map(),
    });

    expect(diff.before.capturedAt).toBe("2026-04-17T09:59:50.000Z");
    expect(diff.now.capturedAt).toBe("2026-04-18T09:59:50.000Z");
    expect(diff.before.value).toBe("Starting at ₹499");
    expect(diff.now.value).toBe("Starting at ₹799");
  });

  it("does not invent diff tokens from event.title for production ad_new shapes", () => {
    const diff = resolveEventDiffCaptures({
      event: adNewEvent,
      proofCapture: null,
      priorProofCapture: null,
      runsById: new Map([["run-0", baselineRun]]),
    });

    expect(hasStoredDiffFieldValues(adNewEvent)).toBe(false);
    expect(diff.before.value).toBeNull();
    expect(diff.now.value).toBeNull();
    expect(canRenderEventDiffPlate({ event: adNewEvent, before: diff.before, now: diff.now })).toBe(
      false,
    );
    expect(
      resolveEventChangeQuietCopy({
        event: adNewEvent,
        hasStoredDiffFields: false,
        hasBothCaptureTimes: true,
      }),
    ).toBe(EVENT_CHANGE_AD_NEW_COPY);
  });

  it("uses the one-capture degrade copy only when from/to exist but a timestamp is missing", () => {
    const diff = resolveEventDiffCaptures({
      event: offerEvent,
      proofCapture: captures[0],
      priorProofCapture: null,
      runsById: new Map(),
    });

    expect(
      resolveEventChangeQuietCopy({
        event: offerEvent,
        hasStoredDiffFields: true,
        hasBothCaptureTimes: false,
      }),
    ).toBe(DIFF_PLATE_DEGRADE_COPY);
    expect(canRenderEventDiffPlate({ event: offerEvent, before: diff.before, now: diff.now })).toBe(
      false,
    );
  });

  it("uses baseline timestamps without inventing field values when from/to are absent", () => {
    const baselineEvent: WatchEventRecord = {
      ...adNewEvent,
      baselineFromRunId: "run-0",
      metadata: { kind: "baseline" },
    };
    const diff = resolveEventDiffCaptures({
      event: baselineEvent,
      proofCapture: captures[0],
      priorProofCapture: null,
      runsById: new Map([["run-0", baselineRun]]),
    });

    expect(diff.before.capturedAt).toBe("2026-04-17T04:01:00.000Z");
    expect(diff.before.value).toBeNull();
    expect(canRenderEventDiffPlate({ event: baselineEvent, before: diff.before, now: diff.now })).toBe(
      false,
    );
  });

  it("restores the per-change no-send delivery line", () => {
    const intelligence = buildChangeIntelligenceSummary(offerEvent, "UTC");
    expect(formatEventDeliveryLine(null)).toBe(EVENT_DELIVERY_NONE_COPY);
    expect(
      formatEventChangeWhy({
        event: offerEvent,
        intelligence,
      }),
    ).toBe("The landing-page offer changed.");
  });

  it.each([
    ["email", "provider_unknown", "Configured email recipient"],
    ["whatsapp", "pending", "Configured WhatsApp recipient"],
    ["slack", "provider_unknown", "Connected Slack workspace"],
  ] as const)(
    "labels accepted-only %s delivery as unconfirmed",
    (channel, webhookStatus, targetValue) => {
      const attempt: PublicDeliveryAttemptSummary = {
        digestRunId: null,
        channel,
        status: "sent",
        webhookStatus,
        targetValue,
        eventIds: [offerEvent.id],
        providerStatusLastSeenAt: null,
        sentAt: "2026-07-15T09:14:00.000Z",
        createdAt: "2026-07-15T09:14:00.000Z",
        errorMessage: "Provider accepted this message, but final delivery is unconfirmed.",
      };

      expect(formatEventDeliveryLine(attempt)).toBe(
        `Last send: Delivery unconfirmed · ${targetValue}.`,
      );
    },
  );

  it("labels only a confirmed receipt delivered", () => {
    const attempt: PublicDeliveryAttemptSummary = {
      digestRunId: null,
      channel: "whatsapp",
      status: "sent",
      webhookStatus: "delivered",
      targetValue: "Configured WhatsApp recipient",
      eventIds: [offerEvent.id],
      providerStatusLastSeenAt: "2026-07-15T09:15:00.000Z",
      sentAt: "2026-07-15T09:14:00.000Z",
      createdAt: "2026-07-15T09:14:00.000Z",
      errorMessage: null,
    };

    expect(formatEventDeliveryLine(attempt)).toBe(
      "Last send: Delivered · Configured WhatsApp recipient.",
    );
  });

  it("does not pair confidence pending with verified when no confidence is stored", () => {
    const intelligence = buildChangeIntelligenceSummary(offerEvent, "UTC");
    const pendingCapture = { ...captures[0], fieldConfidence: {} };
    const label = formatPlateVerification({
      event: offerEvent,
      proofCapture: pendingCapture,
      intelligence,
    });
    expect(label).not.toContain("VERIFIED");
    expect(label).not.toContain("Confidence pending");
  });

  it("labels suppressed events with status-aware copy, not one-capture degrade", () => {
    expect(
      resolveEventChangeQuietCopy({
        event: suppressedEvent,
        hasStoredDiffFields: false,
        hasBothCaptureTimes: false,
      }),
    ).toBe(EVENT_CHANGE_SUPPRESSED_COPY);
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
        events: [offerEvent],
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

    expect(markup).toContain("f9-evidence-diff-plate");
    expect(markup).toContain("17 Apr 2026, 09:59 UTC");
    expect(markup).toContain("18 Apr 2026, 09:59 UTC");
    expect(markup).toContain(STORED_CAPTURE_NOTE);
    expect(markup).toContain(EVENT_DELIVERY_NONE_COPY);
    expect(markup).not.toContain("Insight depth");
  });

  it("renders unenriched ad_new and suppressed events without diff plates", () => {
    const markup = renderChangeFeed({
      checksExpanded: false,
      data: {
        events: [suppressedEvent, adNewEvent],
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
      proofCapturesById: new Map(),
      recentProofCaptures: [],
      renderedAt: new Date("2026-04-18T10:59:50.000Z"),
      sourceCanSchedule: true,
      watchlistId: "watch-1",
    });

    expect(markup).not.toContain("f9-evidence-diff-plate");
    expect(markup).toContain("f9-evidence-change-record");
    expect(markup).toContain(EVENT_CHANGE_AD_NEW_COPY);
    expect(markup).toContain(EVENT_CHANGE_SUPPRESSED_COPY);
    expect(markup).not.toContain(DIFF_PLATE_DEGRADE_COPY);
  });

  it("renders the before/after screenshot pair when both captures have screenshots on file", () => {
    const beforeKey = "landing-pages/2026-04-17/9f8e7d6c-5b4a-3c2d-1e0f-a1b2c3d4e5f6.jpeg";
    const nowKey = "landing-pages/2026-04-18/1a2b3c4d-5e6f-7a8b-9c0d-e1f2a3b4c5d6.jpeg";
    const shotCaptures: ProofCaptureRecord[] = [
      { ...captures[0], screenshotArtifactKey: nowKey },
      { ...captures[1], screenshotArtifactKey: beforeKey },
    ];

    const markup = renderChangeFeed({
      checksExpanded: false,
      data: {
        events: [offerEvent],
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
      proofCapturesById: new Map(shotCaptures.map((capture) => [capture.id, capture])),
      recentProofCaptures: shotCaptures,
      renderedAt: new Date("2026-04-18T10:59:50.000Z"),
      sourceCanSchedule: true,
      watchlistId: "watch-1",
    });

    expect(markup).toContain(`src="/artifacts/proof/${encodeURIComponent(beforeKey)}"`);
    expect(markup).toContain(`src="/artifacts/proof/${encodeURIComponent(nowKey)}"`);
    expect(markup).toContain("The page before the change, as captured");
    expect(markup).toContain("The page after the change, as captured");
    expect(markup.match(/f9-evidence-diff-shot/g)).toHaveLength(2);
  });

  it("keeps the plate text-only when only one side has a screenshot", () => {
    const shotCaptures: ProofCaptureRecord[] = [
      {
        ...captures[0],
        screenshotArtifactKey: "landing-pages/2026-04-18/1a2b3c4d-5e6f-7a8b-9c0d-e1f2a3b4c5d6.jpeg",
      },
      { ...captures[1], screenshotArtifactKey: null },
    ];

    const markup = renderChangeFeed({
      checksExpanded: false,
      data: {
        events: [offerEvent],
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
      proofCapturesById: new Map(shotCaptures.map((capture) => [capture.id, capture])),
      recentProofCaptures: shotCaptures,
      renderedAt: new Date("2026-04-18T10:59:50.000Z"),
      sourceCanSchedule: true,
      watchlistId: "watch-1",
    });

    // The plate still renders its text diff, but never half a side-by-side.
    expect(markup).toContain("f9-evidence-diff-plate");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("f9-evidence-diff-shot");
  });
});

describe("the shared two-timestamp gate (T11)", () => {
  it("refuses a watchlist diff whose before capture is newer than its now", () => {
    expect(
      canRenderEventDiffPlate({
        event: offerEvent,
        before: { value: "₹999", capturedAt: "2026-07-15T10:00:00.000Z" },
        now: { value: "₹799", capturedAt: "2026-07-14T10:00:00.000Z" },
      }),
    ).toBe(false);
  });

  it("accepts a correctly ordered pair when the capture succeeded", () => {
    expect(
      canRenderEventDiffPlate({
        event: offerEvent,
        proofCapture: { ...captures[0], status: "succeeded" },
        before: { value: "₹999", capturedAt: "2026-07-14T10:00:00.000Z" },
        now: { value: "₹799", capturedAt: "2026-07-15T10:00:00.000Z" },
      }),
    ).toBe(true);
  });
});

describe("the render contract is the plate gate (T16 wired)", () => {
  const orderedPair = {
    before: { value: "₹999", capturedAt: "2026-07-14T10:00:00.000Z" },
    now: { value: "₹799", capturedAt: "2026-07-15T10:00:00.000Z" },
  };
  const succeededCapture = { ...captures[0], status: "succeeded" as const };

  it("a suppressed event with perfect stored fields and timestamps never renders a diff plate", () => {
    expect(
      canRenderEventDiffPlate({
        event: suppressedEvent,
        proofCapture: succeededCapture,
        ...orderedPair,
      }),
    ).toBe(false);
  });

  it("a detected event never renders a diff plate regardless of stored evidence", () => {
    expect(
      canRenderEventDiffPlate({
        event: { ...offerEvent, status: "detected", confirmedAt: null },
        proofCapture: succeededCapture,
        ...orderedPair,
      }),
    ).toBe(false);
  });

  it("a confirmed event without a succeeded capture never renders a diff plate", () => {
    expect(
      canRenderEventDiffPlate({
        event: offerEvent,
        proofCapture: { ...captures[0], status: "failed" as const },
        ...orderedPair,
      }),
    ).toBe(false);
    expect(
      canRenderEventDiffPlate({ event: offerEvent, proofCapture: null, ...orderedPair }),
    ).toBe(false);
  });

  it("confirmed + succeeded capture + ordered pair renders", () => {
    expect(
      canRenderEventDiffPlate({
        event: offerEvent,
        proofCapture: succeededCapture,
        ...orderedPair,
      }),
    ).toBe(true);
  });

  it("verification wording cannot leak any casing of verified for unverified evidence", () => {
    const intelligence = buildChangeIntelligenceSummary(offerEvent, "UTC");
    const pendingEvent = { ...offerEvent, status: "proof_pending" as const, confirmedAt: null };
    const emptyConfidenceFailedCapture = {
      ...captures[0],
      status: "failed" as const,
      fieldConfidence: {},
    };
    for (const [event, capture] of [
      [pendingEvent, succeededCapture],
      [offerEvent, emptyConfidenceFailedCapture],
      [pendingEvent, emptyConfidenceFailedCapture],
    ] as const) {
      const label = formatPlateVerification({ event, proofCapture: capture, intelligence });
      expect(label).not.toMatch(/verified/i);
    }
  });

  it("unverified-but-complete evidence gets the honest recorded-not-verified line", () => {
    expect(
      resolveEventChangeQuietCopy({
        event: { ...offerEvent, status: "detected", confirmedAt: null },
        hasStoredDiffFields: true,
        hasBothCaptureTimes: true,
      }),
    ).toBe(EVENT_CHANGE_UNVERIFIED_COPY);
  });
});
