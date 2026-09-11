import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventChangesSection } from "~/components/watchlists/event-changes-section";
import type {
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistRecord,
  WatchlistRunRecord,
} from "~/lib/types";

/**
 * Issue #2477 — the watchlist loader pulls 24 events but only the 12 newest
 * proof captures. A confirmed event whose `proofCaptureId` points at a
 * capture outside that window resolves `proofCapturesById.get(...) → null`,
 * so the feed renders the false copy "no successful stored capture behind
 * it" (EVENT_CHANGE_UNVERIFIED_COPY) and loses its verified diff plate —
 * even though the capture exists in D1.
 *
 * The fix unions the loaded events' `proofCaptureId`s into
 * `recentProofCaptures` via a new `listProofCapturesByIds(env, watchlistId,
 * ids)` data read. This spec drives the REAL loader (mocked `data.server`
 * boundary, same pattern as tests/watchlist-route-loader.test.ts), derives
 * `proofCapturesById` exactly the way competitor-detail.tsx:409 does, and
 * renders `EventChangesSection` the way
 * tests/event-change-green-mark.test.tsx's renderFeed() does. RED pre-fix:
 * the loader never calls `listProofCapturesByIds`, so cap-old is absent and
 * the unverified copy ships.
 */

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
  targetCountry: null,
  isActive: true,
  lastScannedAt: "2026-04-18T09:00:00.000Z",
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-18T09:00:00.000Z",
};

// A confirmed event whose stored capture (`cap-old`) sits OUTSIDE the
// 12-capture recency window — it exists in D1 but is not among the recent
// captures the loader currently fetches.
const confirmedEvent: WatchEventRecord = {
  id: "event-1",
  watchlistId: "watch-1",
  runId: "run-1",
  eventType: "landing_page_offer_changed",
  status: "confirmed",
  importanceScore: 84,
  adId: "ad-1",
  baselineFromRunId: "run-0",
  candidateId: "candidate-1",
  proofCaptureId: "cap-old",
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

// The stored capture: succeeded, on the same proof target, taken just
// before the event was confirmed — i.e. NEWER than the baseline run so the
// before/now pair stays ordered. "Outside the window" is positional, not
// temporal: `listRecentProofCapturesForWatchlist` returns [] — the honest
// extreme of "cap-old exists in D1 but fell out of the 12-cap window" —
// while `listProofCapturesByIds` resolves it by id.
const capOldCapture: ProofCaptureRecord = {
  id: "cap-old",
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
  idempotencyKey: "cap-old",
  attemptedAt: "2026-04-18T09:59:40.000Z",
  succeededAt: "2026-04-18T09:59:50.000Z",
  createdAt: "2026-04-18T09:59:50.000Z",
  updatedAt: "2026-04-18T09:59:50.000Z",
};

const listProofCapturesByIds = vi.fn();

function mockServerBoundary() {
  vi.doMock("~/lib/auth.server", () => ({
    requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue("starter"),
    checkPlanLimit: vi.fn(),
  }));
  vi.doMock("~/lib/email-verification.server", () => ({
    isUserEmailVerified: vi.fn().mockResolvedValue(true),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    getWatchlistDeliveryConfig: vi.fn().mockResolvedValue(null),
    getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
    listDeliveryAttempts: vi.fn().mockResolvedValue([]),
    listDeliveryTargets: vi.fn().mockResolvedValue([]),
    listEventCandidates: vi.fn().mockResolvedValue([]),
    // The 12-cap recency window: cap-old has already aged out of it.
    listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn().mockResolvedValue([confirmedEvent]),
    listWatchEventsByIds: vi.fn().mockResolvedValue([]),
    listWatchlistRuns: vi.fn().mockResolvedValue([baselineRun]),
    listWatchlists: vi.fn().mockResolvedValue([watchlist]),
    // The read the fix must add — this mock defines its contract.
    listProofCapturesByIds,
  }));
}

async function loadAndRender() {
  mockServerBoundary();
  const { loader } = await import("~/routes/app.watchlists");
  const payload = await loader({
    context: { cloudflare: { env: {} } },
    request: new Request("http://localhost/app/watchlists?watchlist=watch-1"),
  } as never);

  // Derive the component inputs exactly the way competitor-detail.tsx:409
  // does: the plate lookup map is built from `recentProofCaptures` alone.
  const proofCapturesById = new Map(
    payload.recentProofCaptures.map((capture) => [capture.id, capture]),
  );
  const element = createElement(EventChangesSection, {
    watchlistId: "watch-1",
    data: {
      events: payload.events,
      runs: payload.runs,
      selectedWatchlist: {
        id: watchlist.id,
        name: watchlist.name,
        lastScannedAt: watchlist.lastScannedAt,
      },
      plan: "starter",
      effectiveDeliveryConfig: { timezone: "UTC" },
      highlightedEventId: null,
    },
    sourceCanSchedule: true,
    renderedAt: new Date("2026-04-18T10:59:50.000Z"),
    proofCapturesById,
    recentProofCaptures: payload.recentProofCaptures,
    lastAttemptByEventId: new Map(),
  });
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  const markup = renderToStaticMarkup(
    createElement(Stub, { initialEntries: ["/"] }),
  );
  return { payload, markup };
}

describe("event changes section — a confirmed event whose capture aged out of the recent-12 window", () => {
  beforeEach(() => {
    vi.resetModules();
    listProofCapturesByIds.mockReset().mockResolvedValue([capOldCapture]);
  });

  afterEach(() => {
    vi.doUnmock("~/lib/auth.server");
    vi.doUnmock("~/lib/plan.server");
    vi.doUnmock("~/lib/email-verification.server");
    vi.doUnmock("~/lib/data.server");
    vi.restoreAllMocks();
  });

  it("loads the event's stored capture by id so the map can resolve it", async () => {
    const { payload } = await loadAndRender();

    expect(listProofCapturesByIds).toHaveBeenCalledWith(
      expect.anything(),
      "watch-1",
      expect.arrayContaining(["cap-old"]),
    );
    expect(payload.recentProofCaptures.map((capture) => capture.id)).toContain(
      "cap-old",
    );
  });

  it("never claims there is no successful stored capture behind a verified change", async () => {
    const { markup } = await loadAndRender();

    expect(markup).not.toContain("no successful stored capture");
    expect(markup).toContain("f9-evidence-diff-plate");
  });
});
