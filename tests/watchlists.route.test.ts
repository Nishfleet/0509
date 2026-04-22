import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const session = {
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

const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
  isActive: true,
  lastScannedAt: "2026-04-18T09:00:00.000Z",
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-18T09:00:00.000Z",
};

const workspaceDeliveryConfig: WorkspaceDeliveryConfigRecord = {
  id: "workspace-delivery-1",
  userId: "user-1",
  sensitivityMode: "auto",
  instantEnabled: false,
  digestEnabled: true,
  emailEnabled: true,
  whatsappEnabled: false,
  quietHours: null,
  timezone: "Asia/Kolkata",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
};

const watchlistDeliveryConfig: WatchlistDeliveryConfigRecord = {
  id: "watch-delivery-1",
  watchlistId: "watch-1",
  userId: "user-1",
  sensitivityMode: "quiet",
  instantEnabled: true,
  digestEnabled: true,
  emailEnabled: true,
  whatsappEnabled: true,
  quietHours: {
    startHour: 22,
    endHour: 8,
  },
  timezone: "Asia/Kolkata",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z",
};

const recentEvents: WatchEventRecord[] = [
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

const recentCandidates: EventCandidateRecord[] = [
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

const recentRuns: WatchlistRunRecord[] = [
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

const recentProofCaptures: ProofCaptureRecord[] = [
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
];

const deliveryTargets: DeliveryTargetRecord[] = [
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

const recentDeliveryAttempts: DeliveryAttemptRecord[] = [
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

const discoveryStatus = {
  status: "healthy",
  provider: "meta_library_browser",
  mode: "live",
  summary: "Live commercial discovery running through Browser Run.",
  lastCheckedAt: "2026-04-18T10:06:00.000Z",
  lastErrorCode: null,
  lastErrorMessage: null,
} as const;

function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

async function mockRouter(overrides: {
  actionData?: unknown;
  loaderData?: unknown;
  searchParams?: URLSearchParams;
}) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useActionData: vi.fn().mockReturnValue(overrides.actionData),
      useLoaderData: vi.fn().mockReturnValue(overrides.loaderData),
      useSearchParams: vi.fn().mockReturnValue([
        overrides.searchParams ?? new URLSearchParams("watchlist=watch-1"),
        vi.fn(),
      ]),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("watchlists route loader", () => {
  it("returns bounded proof, delivery, and candidate state for the selected watchlist", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      resolveCommercialAdSourceStatus: vi.fn().mockResolvedValue(discoveryStatus),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(watchlistDeliveryConfig),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(workspaceDeliveryConfig),
      listDeliveryAttempts: vi.fn().mockResolvedValue(recentDeliveryAttempts),
      listDeliveryTargets: vi
        .fn()
        .mockResolvedValueOnce(deliveryTargets)
        .mockResolvedValueOnce([]),
      listEventCandidates: vi.fn().mockResolvedValue(recentCandidates),
      listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue(recentProofCaptures),
      listWatchEvents: vi.fn().mockResolvedValue(recentEvents),
      listWatchlistRuns: vi.fn().mockResolvedValue(recentRuns),
      listWatchlists: vi.fn().mockResolvedValue([watchlist]),
    }));

    const { loader } = await import("~/routes/app.watchlists");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists?watchlist=watch-1"),
    } as never);

    expect(result).toMatchObject({
      selectedWatchlist: watchlist,
      eventCandidates: recentCandidates,
      events: recentEvents,
      runs: recentRuns,
      deliveryTargets,
      recentDeliveryAttempts,
      effectiveDeliveryConfig: {
        sensitivityMode: "quiet",
        instantEnabled: true,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: true,
      },
      discoveryStatus,
      proofSummary: {
        totalAttempts: 1,
        successfulAttempts: 1,
        failedAttempts: 0,
        lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
      },
    });
  });
});

describe("watchlists route actions", () => {
  it("returns a friendly message when manual refresh is rate limited", async () => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "rate_limited" as const;

      constructor(message: string) {
        super(message);
        this.name = "CommercialDiscoveryError";
      }
    }

    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: MockCommercialDiscoveryError,
    }));
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
    }));
    vi.doMock("~/lib/monitoring.server", () => ({
      runWatchlistManual: vi
        .fn()
        .mockRejectedValue(new MockCommercialDiscoveryError("Rate limit exceeded")),
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "refresh-watchlist");
    formData.set("watchlistId", "watch-1");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message:
        "Commercial discovery is temporarily rate limited. Scheduled warmups will keep retrying.",
      ok: false,
    });
  });

  it("saves watchlist delivery settings with parsed quiet hours and timezone", async () => {
    const upsertWatchlistDeliveryConfig = vi.fn().mockResolvedValue(watchlistDeliveryConfig);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(workspaceDeliveryConfig),
      upsertWatchlistDeliveryConfig,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "save-delivery-config");
    formData.set("watchlistId", "watch-1");
    formData.set("sensitivityMode", "aggressive");
    formData.set("instantEnabled", "on");
    formData.set("digestEnabled", "on");
    formData.set("emailEnabled", "on");
    formData.set("timezone", "Asia/Kolkata");
    formData.set("quietHoursStart", "22");
    formData.set("quietHoursEnd", "8");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery settings updated.",
      ok: true,
    });
    expect(upsertWatchlistDeliveryConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        watchlistId: "watch-1",
        userId: "user-1",
        sensitivityMode: "aggressive",
        instantEnabled: true,
        digestEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        timezone: "Asia/Kolkata",
        quietHours: {
          startHour: 22,
          endHour: 8,
        },
      }),
    );
  });

  it("adds a new watchlist delivery target with explicit opt-in state", async () => {
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "add-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "whatsapp");
    formData.set("targetValue", "+919999999999");
    formData.set("explicitOptIn", "on");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target saved.",
      ok: true,
    });
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        watchlistId: "watch-1",
        userId: "user-1",
        channel: "whatsapp",
        targetValue: "+919999999999",
        isOptedIn: true,
        templateEligible: false,
      }),
    );
  });

  it("pauses an existing watchlist delivery target", async () => {
    const upsertDeliveryTarget = vi.fn();

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getWatchlist: vi.fn().mockResolvedValue(watchlist),
      upsertDeliveryTarget,
    }));

    const { action } = await import("~/routes/app.watchlists");
    const formData = new FormData();
    formData.set("intent", "toggle-delivery-target");
    formData.set("watchlistId", "watch-1");
    formData.set("channel", "email");
    formData.set("targetValue", "owner@example.com");
    formData.set("isPaused", "true");

    const result = await action({
      context: createContext(),
      request: new Request("http://localhost/app/watchlists", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(result).toEqual({
      message: "Delivery target paused.",
      ok: true,
    });
    expect(upsertDeliveryTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        watchlistId: "watch-1",
        userId: "user-1",
        channel: "email",
        targetValue: "owner@example.com",
        isPaused: true,
      }),
    );
  });
});

describe("watchlists route rendering", () => {
  it("renders the selected watchlist as a proof-first control panel", async () => {
    await mockRouter({
      actionData: undefined,
      loaderData: {
        watchlists: [watchlist],
        selectedWatchlist: watchlist,
        eventCandidates: recentCandidates,
        events: recentEvents,
        runs: recentRuns,
        workspaceDeliveryConfig,
        watchlistDeliveryConfig,
        discoveryStatus,
        effectiveDeliveryConfig: {
          sensitivityMode: "quiet",
          instantEnabled: true,
          digestEnabled: true,
          emailEnabled: true,
          whatsappEnabled: true,
          quietHours: {
            startHour: 22,
            endHour: 8,
          },
          timezone: "Asia/Kolkata",
        },
        deliveryTargets,
        workspaceDeliveryTargets: [],
        recentDeliveryAttempts,
        recentProofCaptures,
        proofSummary: {
          totalAttempts: 1,
          successfulAttempts: 1,
          failedAttempts: 0,
          skippedAttempts: 0,
          lastAttemptAt: "2026-04-18T09:59:50.000Z",
          lastSuccessfulProofAt: "2026-04-18T09:59:50.000Z",
        },
      },
    });

    const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    expect(markup).toContain("See what changed");
    expect(markup).toContain("Commercial discovery");
    expect(markup).toContain("Browser Run live capture");
    expect(markup).toContain("Proof and delivery");
    expect(markup).toContain("High confidence");
    expect(markup).toContain("Why this alerted");
    expect(markup).toContain("Recent proof attempts");
    expect(markup).toContain("Delivery settings");
  });
});
