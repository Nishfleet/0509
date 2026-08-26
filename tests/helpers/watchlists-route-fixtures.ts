import { afterEach, beforeEach, vi } from "vitest";

import type {
  DeliveryAttemptRecord,
  DeliveryTargetRecord,
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistDeliveryConfigRecord,
  WatchlistRecord,
  WatchlistRunRecord,
  WorkspaceDeliveryConfigRecord,
} from "~/lib/types";

export const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
};

export const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
  targetCountry: null,
  isActive: true,
  lastScannedAt: "2026-04-18T09:00:00.000Z",
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-18T09:00:00.000Z",
};

export const workspaceDeliveryConfig: WorkspaceDeliveryConfigRecord = {
  id: "workspace-delivery-1",
  userId: "user-1",
  sensitivityMode: "auto",
  instantEnabled: false,
  digestEnabled: true,
  digestCadencePreference: "plan_default",
  emailEnabled: true,
  whatsappEnabled: false,
  slackEnabled: false,
  teamsEnabled: false,
  quietHours: null,
  timezone: "Asia/Kolkata",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
};

export const watchlistDeliveryConfig: WatchlistDeliveryConfigRecord = {
  id: "watch-delivery-1",
  watchlistId: "watch-1",
  userId: "user-1",
  sensitivityMode: "quiet",
  instantEnabled: true,
  digestEnabled: true,
  emailEnabled: true,
  whatsappEnabled: true,
  slackEnabled: false,
  teamsEnabled: false,
  quietHours: {
    startHour: 22,
    endHour: 8,
  },
  timezone: "Asia/Kolkata",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
};

export const recentEvents: WatchEventRecord[] = [
  {
    id: "event-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 84,
    adId: "ad-1",
    baselineFromRunId: null,
    candidateId: "candidate-1",
    proofCaptureId: "proof-1",
    title: "Landing page offer changed",
    summary: "The landing-page offer changed.",
    metadata: {
      advertiser: "Nykaa",
      proofTargetIdentity: "watch-1:ad-1:example.com/page",
      from: "Starting at ₹499",
      to: "Starting at ₹799",
    },
    confirmedAt: "2026-04-18T10:00:00.000Z",
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-04-18T10:00:00.000Z",
    createdAt: "2026-04-18T10:00:00.000Z",
  },
];

export const recentCandidates: EventCandidateRecord[] = [
  {
    id: "candidate-1",
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status: "confirmed",
    importanceScore: 84,
    adId: "ad-1",
    proofTargetId: "target-1",
    title: "Landing page offer changed",
    summary: "The landing-page offer changed.",
    metadata: {
      advertiser: "Nykaa",
    },
    proofRequired: true,
    skipReason: null,
    dedupeReason: null,
    detectedAt: "2026-04-18T10:00:00.000Z",
    lastEvaluatedAt: "2026-04-18T10:00:05.000Z",
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:05.000Z",
  },
];

export const recentRuns: WatchlistRunRecord[] = [
  {
    id: "run-1",
    watchlistId: "watch-1",
    triggerType: "manual",
    status: "succeeded",
    pageBudget: 5,
    pagesScanned: 2,
    baselineFromRunId: "run-0",
    summary: {
      adsSeen: 4,
      events: 2,
      candidatesDetected: 3,
      proofsAttempted: 1,
      eventsConfirmed: 2,
      sendsTriggered: 1,
    },
    startedAt: "2026-04-18T10:00:00.000Z",
    finishedAt: "2026-04-18T10:01:00.000Z",
    errorCode: null,
    errorMessage: null,
  },
];

export const recentProofCaptures: ProofCaptureRecord[] = [
  {
    id: "proof-1",
    proofTargetId: "target-1",
    status: "succeeded",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: "proofs/proof-1.jpeg",
    htmlArtifactKey: "proofs/proof-1.html",
    extractedFields: {
      rawHeadline: "Glow sale",
      normalizedHeadline: "glow sale",
      normalizedHeadlineHash: "hash-a",
      ctaText: "Shop now",
      priceText: "Starting at ₹799",
      formPresent: true,
    },
    fieldConfidence: {
      headline: 0.95,
      ctaText: 0.82,
      priceText: 0.88,
    },
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:1",
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
    screenshotArtifactKey: "proofs/proof-0.jpeg",
    htmlArtifactKey: "proofs/proof-0.html",
    extractedFields: {
      rawHeadline: "Glow sale",
      normalizedHeadline: "glow sale",
      normalizedHeadlineHash: "hash-b",
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: true,
    },
    fieldConfidence: {
      headline: 0.9,
      ctaText: 0.8,
      priceText: 0.85,
    },
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:0",
    attemptedAt: "2026-04-17T09:59:40.000Z",
    succeededAt: "2026-04-17T09:59:50.000Z",
    createdAt: "2026-04-17T09:59:50.000Z",
    updatedAt: "2026-04-17T09:59:50.000Z",
  },
];

export const deliveryTargets: DeliveryTargetRecord[] = [
  {
    id: "target-email-1",
    userId: "user-1",
    watchlistId: "watch-1",
    channel: "email",
    targetValue: "owner@example.com",
    validationStatus: "validated",
    isValidated: true,
    isOptedIn: true,
    optInSource: "manual",
    optedInAt: "2026-04-18T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    optedOutAt: null,
    templateEligible: true,
    lastSuccessfulDeliveryAt: "2026-04-18T10:05:00.000Z",
    lastSuccessfulAttemptId: "attempt-1",
    providerIdentifier: null,
    metadata: {},
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T10:05:00.000Z",
  },
];

export const recentDeliveryAttempts: DeliveryAttemptRecord[] = [
  {
    id: "attempt-1",
    userId: "user-1",
    watchlistId: "watch-1",
    digestRunId: null,
    deliveryTargetId: "target-email-1",
    lane: "customer",
    channel: "email",
    provider: "resend",
    status: "sent",
    webhookStatus: "delivered",
    targetValue: "owner@example.com",
    providerMessageId: "msg-1",
    providerStatusLastSeenAt: "2026-04-18T10:05:10.000Z",
    templateName: null,
    eventIds: ["event-1"],
    payloadSnapshot: {
      kind: "watch_event_alert",
    },
    idempotencyKey: "delivery-1",
    errorMessage: null,
    sentAt: "2026-04-18T10:05:00.000Z",
    failedAt: null,
    createdAt: "2026-04-18T10:05:00.000Z",
    updatedAt: "2026-04-18T10:05:10.000Z",
  },
];

export const discoveryStatus = {
  status: "healthy",
  provider: "meta_library_browser",
  mode: "live",
  summary: "Live commercial discovery running through Browser Run.",
  lastCheckedAt: "2026-04-18T10:06:00.000Z",
  lastErrorCode: null,
  lastErrorMessage: null,
} as const;

export function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

export function setupWatchlistsRouteTestIsolation() {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });
}
