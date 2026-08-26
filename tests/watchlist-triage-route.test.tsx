import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistRecord,
  WatchlistRunRecord,
} from "~/lib/types";

/**
 * Zero-noise record on the app watchlist surface (2026-08-06, sealed packet
 * acceptance): the five fixtures classify truthfully through the route's
 * presentation function, and the record line renders above the change feed —
 * a failed or pending check never renders as an all-quiet line.
 */

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<
  string,
  unknown
>;

const watchlist: WatchlistRecord = {
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

function run(status: WatchlistRunRecord["status"]): WatchlistRunRecord {
  return {
    id: `run-${status}`,
    watchlistId: "watch-1",
    triggerType: "scheduled",
    status,
    pageBudget: 5,
    pagesScanned: 2,
    baselineFromRunId: "run-0",
    summary: { adsSeen: 4, events: 0 },
    startedAt: "2026-04-18T10:00:00.000Z",
    finishedAt: status === "succeeded" ? "2026-04-18T10:01:00.000Z" : null,
    errorCode: status === "failed" ? "provider_unavailable" : null,
    errorMessage: null,
  };
}

function event(status: WatchEventRecord["status"]): WatchEventRecord {
  return {
    id: `event-${status}`,
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status,
    importanceScore: 84,
    adId: "ad-1",
    baselineFromRunId: null,
    candidateId: "candidate-1",
    proofCaptureId: status === "confirmed" ? "proof-1" : null,
    title: "Landing page offer changed",
    summary: "The landing-page offer changed.",
    metadata: { from: "Starting at ₹499", to: "Starting at ₹799" },
    confirmedAt: status === "confirmed" ? "2026-04-18T10:00:00.000Z" : null,
    suppressedAt: null,
    invalidatedAt: null,
    lastEvaluatedAt: "2026-04-18T10:00:00.000Z",
    createdAt: "2026-04-18T10:00:00.000Z",
  };
}

function candidate(
  status: EventCandidateRecord["status"],
): EventCandidateRecord {
  return {
    id: `candidate-${status}`,
    watchlistId: "watch-1",
    runId: "run-1",
    eventType: "landing_page_offer_changed",
    status,
    importanceScore: 72,
    adId: "ad-1",
    proofTargetId: "target-1",
    title: "Landing page offer changed",
    summary: "Offer changed.",
    metadata: {},
    proofRequired: true,
    skipReason: null,
    dedupeReason: status === "suppressed" ? "proof_duplicate" : null,
    detectedAt: "2026-04-18T10:00:00.000Z",
    lastEvaluatedAt: "2026-04-18T10:00:00.000Z",
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:00.000Z",
  };
}

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
    attemptedAt: "2026-04-18T09:59:40.000Z",
    succeededAt: status === "succeeded" ? "2026-04-18T09:59:50.000Z" : null,
    createdAt: "2026-04-18T09:59:50.000Z",
    updatedAt: "2026-04-18T09:59:50.000Z",
  };
}

describe("resolveWatchlistTriageRecord (app surface)", () => {
  it("records an unchanged page as an explicit all-quiet finding with a checked-at stamp", async () => {
    const { resolveWatchlistTriageRecord } = await import(
      "~/routes/app.watchlists"
    );

    const record = resolveWatchlistTriageRecord({
      events: [],
      candidates: [],
      runs: [run("succeeded")],
      proofCaptures: [],
      lastScannedAt: watchlist.lastScannedAt,
    });

    expect(record).not.toBeNull();
    expect(record!.label).toBe("All quiet");
    expect(record!.line).toContain("Checks completed and nothing changed");
    expect(record!.line).toContain("No action needed — nothing new to act on.");
    expect(record!.stampIso).toBe("2026-04-18T10:01:00.000Z");
  });

  it("exposes routine-only suppression with its reason instead of quiet", async () => {
    const { resolveWatchlistTriageRecord } = await import(
      "~/routes/app.watchlists"
    );

    const record = resolveWatchlistTriageRecord({
      events: [],
      candidates: [candidate("suppressed")],
      runs: [run("succeeded")],
      proofCaptures: [],
      lastScannedAt: watchlist.lastScannedAt,
    });

    expect(record!.label).toBe("Routine changes only");
    expect(record!.reasons).toEqual([
      "Repeat of a change already reported this period",
    ]);
    expect(record!.line).not.toContain("All quiet");
  });

  it("keeps meaningful price/CTA changes on the change feed — no record line", async () => {
    const { resolveWatchlistTriageRecord } = await import(
      "~/routes/app.watchlists"
    );

    const record = resolveWatchlistTriageRecord({
      events: [event("confirmed")],
      candidates: [candidate("confirmed")],
      runs: [run("succeeded")],
      proofCaptures: [proofCapture("succeeded")],
      lastScannedAt: watchlist.lastScannedAt,
    });

    expect(record).toBeNull();
  });

  it("never renders a provider timeout as all quiet", async () => {
    const { resolveWatchlistTriageRecord } = await import(
      "~/routes/app.watchlists"
    );

    const record = resolveWatchlistTriageRecord({
      events: [],
      candidates: [],
      runs: [run("succeeded")],
      proofCaptures: [proofCapture("failed")],
      lastScannedAt: watchlist.lastScannedAt,
    });

    expect(record!.label).toBe("Proof capture failed");
    expect(record!.line).toContain("No change is confirmed without proof.");
    expect(record!.line).not.toContain("All quiet");
  });

  it("never renders a proof-pending state as all quiet", async () => {
    const { resolveWatchlistTriageRecord } = await import(
      "~/routes/app.watchlists"
    );

    const record = resolveWatchlistTriageRecord({
      events: [],
      candidates: [candidate("proof_pending")],
      runs: [run("succeeded")],
      proofCaptures: [proofCapture("pending")],
      lastScannedAt: watchlist.lastScannedAt,
    });

    expect(record!.label).toBe("Evidence pending");
    expect(record!.line).toContain("nothing is confirmed yet");
    expect(record!.line).not.toContain("All quiet");
  });

  it("states a failed latest check instead of hiding it behind an all-quiet record", async () => {
    const { resolveWatchlistTriageRecord } = await import(
      "~/routes/app.watchlists"
    );

    const record = resolveWatchlistTriageRecord({
      events: [],
      candidates: [],
      runs: [run("failed"), run("succeeded")],
      proofCaptures: [],
      lastScannedAt: watchlist.lastScannedAt,
    });

    expect(record!.label).toBe("Latest check didn't complete");
    expect(record!.line).toContain("We're retrying");
  });

  it("leaves first-scan states to the existing surfaces", async () => {
    const { resolveWatchlistTriageRecord } = await import(
      "~/routes/app.watchlists"
    );

    expect(
      resolveWatchlistTriageRecord({
        events: [],
        candidates: [],
        runs: [run("running")],
        proofCaptures: [],
        lastScannedAt: null,
      }),
    ).toBeNull();
  });
});

describe("watchlists route render — zero-noise record", () => {
  async function mockRouter(loaderData: unknown) {
    vi.doMock("react-router", async () => {
      const actual =
        await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement(
            "a",
            { ...props, href: typeof to === "string" ? to : "" },
            children,
          ),
        useActionData: vi.fn().mockReturnValue(undefined),
        useFetcher: vi.fn().mockReturnValue({
          state: "idle",
          data: undefined,
          Form: ({ children, ...props }: MockFormProps) =>
            React.createElement("form", props, children),
        }),
        useLoaderData: vi.fn().mockReturnValue(loaderData),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
        useRevalidator: vi
          .fn()
          .mockReturnValue({ state: "idle", revalidate: vi.fn() }),
        useSearchParams: vi
          .fn()
          .mockReturnValue([
            new URLSearchParams("watchlist=watch-1"),
            vi.fn(),
          ]),
      };
    });
  }

  function quietLoaderData() {
    return {
      renderedAt: "2026-04-18T10:59:50.000Z",
      plan: "starter",
      canManageDelivery: false,
      verifiedAccountEmail: "owner@example.com",
      watchlists: [watchlist],
      selectedWatchlist: watchlist,
      highlightedEventId: null,
      eventCandidates: [],
      events: [],
      runs: [run("succeeded")],
      workspaceDeliveryConfig: {
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "UTC",
      },
      watchlistDeliveryConfig: null,
      discoveryStatus: {
        status: "healthy",
        provider: "meta_library_browser",
        mode: "live",
        summary: "Live commercial discovery running.",
        lastCheckedAt: "2026-04-18T10:06:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
      },
      effectiveDeliveryConfig: {
        sensitivityMode: "balanced",
        instantEnabled: false,
        digestEnabled: true,
        digestCadencePreference: "plan_default",
        emailEnabled: true,
        whatsappEnabled: false,
        slackEnabled: false,
        quietHours: null,
        timezone: "UTC",
      },
      deliveryTargets: [],
      workspaceDeliveryTargets: [],
      recentDeliveryAttempts: [],
      recentProofCaptures: [],
      proofSummary: {
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        skippedAttempts: 0,
        skippedDueToBudget: 0,
        skippedDueToRateLimit: 0,
        skippedDueToDedupe: 0,
        lastAttemptAt: null,
        lastSuccessfulProofAt: null,
      },
      creativeWall: [],
      trendDailyActivity: [],
      dossier: null,
      aggression: null,
      counterBrief: null,
      counterBriefLocked: false,
      showPresenceNav: false,
      whatsappAvailable: false,
    };
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("renders the all-quiet record above the change feed, never claiming it over failures", async () => {
    await mockRouter(quietLoaderData());

    const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    expect(markup).toContain("All quiet");
    expect(markup).toContain("No action needed — nothing new to act on.");
    expect(markup).toContain("f9-evidence-quiet-line");
    expect(markup).not.toContain("All quiet: no competitor moves worth action");
  });

  it("renders a failed proof capture as an honest record instead of quiet", async () => {
    await mockRouter({
      ...quietLoaderData(),
      recentProofCaptures: [proofCapture("failed")],
    });

    const { default: WatchlistsRoute } = await import("~/routes/app.watchlists");
    const markup = renderToStaticMarkup(createElement(WatchlistsRoute));

    expect(markup).toContain("Proof capture failed");
    expect(markup).toContain("No change is confirmed without proof.");
    expect(markup).not.toContain("All quiet");
  });
});
