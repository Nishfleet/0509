import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord, ProofCaptureRecord, WatchlistRecord } from "~/lib/types";

/**
 * Issue #2893 — landing-page extraction-funnel regression test.
 *
 * Drives the REAL monitoring pipeline end-to-end on the node project:
 * `runWatchlistManual` → proof-candidate selection → `captureLandingPageSnapshot`
 * (Browserless BQL leg answered by a stubbed global `fetch`) → the real
 * `extractLandingPageSignals` on a fixture page → the real
 * `classifyCaptureValidity` / `evaluateProofBackedEvents` diff → confirmed
 * `landing_page_*` events → the per-run funnel persisted on the run summary.
 *
 * Only the boundaries are doubled: the network (`fetch`) and the D1 surface
 * (`data.server` state fakes). Every pipeline stage in between — extraction,
 * the capture-validity gate, the field diff, event suppression, the funnel
 * counters — runs its production code.
 */

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
  lastScannedAt: null,
  createdAt: "2026-04-10T00:00:00.000Z", // fixed-date: historical fixture (issue #3215 sweep)
  updatedAt: "2026-04-10T00:00:00.000Z",
};

const FIXTURE_URL = "https://funnel-fixture.example/offer";

const baseAd: AdRecord = {
  metaAdId: "meta-nykaa-1",
  advertiser: "Nykaa",
  body: "Flat 30% off",
  previewHeadline: "Glow sale",
  previewSubhead: "Weekend only",
  hook: "Glow sale",
  offer: "Flat 30% off",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: FIXTURE_URL,
  adSnapshotUrl: null,
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "demo",
  analysisFields: [],
};

// The fixture landing page — real HTML the real extractor parses. Version A
// and B differ ONLY in CTA text and price so the diff produces exactly
// `landing_page_cta_changed` + `landing_page_offer_changed`.
function fixtureHtml(version: "a" | "b") {
  const cta = version === "a" ? "Shop now" : "Get offer";
  const price = version === "a" ? "Starting at ₹499" : "Starting at ₹899";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Glow Serum — clearer skin in 30 days</title>
  <meta property="og:title" content="Glow Serum Sale">
</head>
<body>
  <main>
    <h1>Glow Serum Sale</h1>
    <p>Dermatologist-formulated vitamin C serum with hyaluronic acid. The
    weekend sale is live for every skin type, with free tracked shipping on
    all orders and a thirty-day money-back promise.</p>
    <p class="offer">${price}</p>
    <button class="cta" type="button">${cta}</button>
    <form action="/subscribe" method="post">
      <label for="email">Get restock alerts</label>
      <input id="email" name="email" type="email">
      <button type="submit">Submit</button>
    </form>
    <footer><p>Nykaa — beauty, delivered.</p></footer>
  </main>
</body>
</html>`;
}

// A minimal-but-valid screenshot payload: the BQL leg returns base64 bytes and
// the pipeline only needs them to be non-empty (screenshotCorroborates) and
// persistable.
const SCREENSHOT_B64 = Buffer.from("fixture-jpeg-bytes").toString("base64");

type StoredProofCapture = ProofCaptureRecord & Record<string, unknown>;

type FinishedRun = {
  runId: string;
  input: {
    status: string;
    pagesScanned: number;
    summary: Record<string, unknown>;
  };
};

function installMocks() {
  const state = {
    runSeq: 0,
    finishedRuns: [] as FinishedRun[],
    proofCaptures: [] as StoredProofCapture[],
    proofTargets: new Map<string, Record<string, unknown>>(),
    events: [] as Array<Record<string, unknown>>,
    observations: new Map<string, Array<Record<string, unknown>>>(),
    artifactPuts: [] as string[],
  };

  const observationRow = (runId: string) => ({
    id: `obs-${runId}`,
    ad_id: baseAd.metaAdId,
    watchlist_run_id: runId,
    landing_page_snapshot_id: null,
    landing_page_url: FIXTURE_URL,
    normalized_headline_hash: "hash-a",
    raw_headline: "Glow serum sale",
    seen_at: new Date().toISOString(),
    is_active: 1,
    metadata_json: JSON.stringify({ advertiser: "Nykaa" }),
  });

  vi.doMock("~/lib/analysis.server", () => ({
    buildAnalysisFields: vi.fn(() => []),
  }));
  vi.doMock("~/lib/creative-text.server", () => ({
    captureCreativeText: vi.fn(),
    createMissingCreativeCaptureResult: vi.fn(() => null),
  }));
  vi.doMock("~/lib/meta-api.server", () => ({
    MetaApiError: class MetaApiError extends Error {},
    demoSearch: vi.fn(),
    filterAdsBySearchFilters: vi.fn((ads: AdRecord[]) => ads),
    searchAds: vi.fn().mockResolvedValue({
      ads: [baseAd],
      nextCursor: null,
      source: "demo",
    }),
  }));
  vi.doMock("~/lib/delivery.server", () => ({
    deliverWatchlistAlerts: vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
      details: [
        {
          status: "sent",
          outcome: "provider_accepted",
          claimedByThisRun: true,
          providerAttemptedByThisRun: true,
          duplicate: false,
          source: "current_claim",
        },
      ],
    }),
    deliverWeeklyDigest: vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
    }),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue("starter"),
    PLAN_LIMITS: {
      free: { digests: false, digestCadence: "none" },
      starter: { digests: true, digestCadence: "weekly" },
      agency: { digests: true, digestCadence: "daily_and_weekly" },
    },
  }));
  vi.doMock("~/lib/sources/run.server", () => ({
    runSources: vi.fn().mockResolvedValue({ results: [] }),
  }));

  vi.doMock("~/lib/data.server", () => ({
    addDigestItem: vi.fn(),
    claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
    clearDigestItem: vi.fn(),
    completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
    countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
    countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
    createAdObservation: vi.fn(
      async (_env: unknown, input: { watchlistRunId: string }) => {
        const rows = state.observations.get(input.watchlistRunId) ?? [];
        const row = observationRow(input.watchlistRunId);
        rows.push(row);
        state.observations.set(input.watchlistRunId, rows);
        return row.id;
      },
    ),
    createDigestRun: vi
      .fn()
      .mockResolvedValue({ digestRunId: "digest-1", created: true }),
    createEventCandidate: vi.fn(async () => `candidate-${state.events.length + 1}`),
    createLandingPageSnapshot: vi.fn(async () => "snapshot-1"),
    createProofCapture: vi.fn(
      async (_env: unknown, input: Record<string, unknown>) => {
        const id = `proof-${state.proofCaptures.length + 1}`;
        const now = new Date().toISOString();
        state.proofCaptures.push({
          id,
          proofTargetId: input.proofTargetId as string,
          status: input.status as ProofCaptureRecord["status"],
          skipReason: (input.skipReason as string | null) ?? null,
          failureCode: (input.failureCode as string | null) ?? null,
          failureReason: (input.failureReason as string | null) ?? null,
          screenshotArtifactKey:
            (input.screenshotArtifactKey as string | null) ?? null,
          htmlArtifactKey: (input.htmlArtifactKey as string | null) ?? null,
          extractedFields: (input.extractedFields as Record<string, unknown>) ??
            {},
          fieldConfidence:
            (input.fieldConfidence as Record<string, unknown> | null) ?? null,
          extractionWarnings:
            (input.extractionWarnings as string[] | null) ?? [],
          captureMetadata:
            (input.captureMetadata as Record<string, unknown>) ?? {},
          renderMode: (input.renderMode as string | null) ?? null,
          deviceProfile: (input.deviceProfile as string | null) ?? null,
          extractorVersion: (input.extractorVersion as string | null) ?? null,
          idempotencyKey: (input.idempotencyKey as string | null) ?? null,
          attemptedAt: (input.attemptedAt as string | null) ?? now,
          succeededAt: (input.succeededAt as string | null) ?? null,
          createdAt: now,
          updatedAt: now,
        } as StoredProofCapture);
        return id;
      },
    ),
    createWatchEvent: vi.fn(
      async (_env: unknown, input: Record<string, unknown>) => {
        const id = `event-${state.events.length + 1}`;
        state.events.push({
          id,
          watchlistId: input.watchlistId,
          runId: input.runId,
          eventType: input.eventType,
          status: input.status,
          importanceScore: input.importanceScore ?? 0,
          adId: input.adId ?? null,
          baselineFromRunId: input.baselineFromRunId ?? null,
          candidateId: input.candidateId ?? null,
          proofCaptureId: input.proofCaptureId ?? null,
          title: input.title ?? null,
          summary: input.summary ?? null,
          metadata: input.metadata ?? {},
          confirmedAt: input.confirmedAt ?? new Date().toISOString(),
          suppressedAt: null,
          invalidatedAt: null,
          lastEvaluatedAt: input.lastEvaluatedAt ?? new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
        return id;
      },
    ),
    createWatchlistRun: vi.fn(async () => `run-${++state.runSeq}`),
    finishWatchlistRun: vi.fn(
      async (_env: unknown, runId: string, input: FinishedRun["input"]) => {
        state.finishedRuns.push({ runId, input });
      },
    ),
    getDigestByPeriod: vi.fn().mockResolvedValue(null),
    getDigest: vi.fn().mockResolvedValue(null),
    getUserDeliveryProfile: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      name: "Owner",
    }),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
    listRetryableInstantAttempts: vi.fn().mockResolvedValue([]),
    hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
    getRecentSuccessfulRuns: vi.fn(async () =>
      state.finishedRuns
        .filter((finished) => finished.input.status === "succeeded")
        .map((finished) => ({ id: finished.runId })),
    ),
    getSavedQuery: vi.fn(),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
    listActiveWatchlists: vi.fn().mockResolvedValue([watchlist]),
    listObservationsForRun: vi.fn(async (_env: unknown, runId: string) => {
      return state.observations.get(runId) ?? [];
    }),
    listProofCapturesForTarget: vi.fn(
      async (_env: unknown, targetId: string) =>
        state.proofCaptures
          .filter((capture) => capture.proofTargetId === targetId)
          .sort((a, b) => b.attemptedAt!.localeCompare(a.attemptedAt!)),
    ),
    listProofCapturesForTargets: vi.fn(
      async (_env: unknown, targetIds: string[]) => {
        const map = new Map<string, StoredProofCapture[]>();
        for (const id of targetIds) {
          map.set(
            id,
            state.proofCaptures
              .filter((capture) => capture.proofTargetId === id)
              .sort((a, b) => b.attemptedAt!.localeCompare(a.attemptedAt!)),
          );
        }
        return map;
      },
    ),
    listRecentWorkspaceProofCaptures: vi.fn(async () => [
      ...state.proofCaptures,
    ]),
    listSuccessfulProofCapturesForAd: vi.fn(async () =>
      state.proofCaptures.filter((capture) => capture.status === "succeeded"),
    ),
    listLastSuccessfulProofCapturesForAds: vi.fn(
      async (_env: unknown, _watchlistId: string, adIds: string[]) => {
        const map = new Map<string, StoredProofCapture[]>();
        for (const adId of adIds) {
          const targetIds = new Set(
            [...state.proofTargets.values()]
              .filter((target) => target.adId === adId)
              .map((target) => target.id as string),
          );
          map.set(
            adId,
            state.proofCaptures
              .filter(
                (capture) =>
                  capture.status === "succeeded" &&
                  targetIds.has(capture.proofTargetId),
              )
              .sort((a, b) =>
                (b.succeededAt ?? "").localeCompare(a.succeededAt ?? ""),
              )
              .slice(0, 5),
          );
        }
        return map;
      },
    ),
    listWatchEvents: vi.fn(async () => [...state.events]),
    listWatchEventsForRun: vi.fn(
      async (_env: unknown, _watchlistId: string, runId: string) =>
        state.events.filter((event) => event.runId === runId),
    ),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listWatchEventsBetween: vi.fn().mockResolvedValue([]),
    listWatchEventsByIds: vi.fn().mockResolvedValue([]),
    listWatchlists: vi.fn().mockResolvedValue([watchlist]),
    logMetaIntegrationStatus: vi.fn(),
    recordWatchlistCapacitySkip: vi.fn(),
    touchWatchlistScanned: vi.fn(),
    upsertAd: vi.fn(),
    upsertDigestDelivery: vi.fn(),
    upsertProofTarget: vi.fn(
      async (_env: unknown, input: Record<string, unknown>) => {
        const identity = input.proofTargetIdentity as string;
        const existing = state.proofTargets.get(identity);
        const now = new Date().toISOString();
        const target = {
          id: existing?.id ?? `target-${state.proofTargets.size + 1}`,
          watchlistId: input.watchlistId,
          adId: input.adId ?? null,
          landingPageUrl: input.landingPageUrl,
          canonicalPageIdentity: input.canonicalPageIdentity,
          proofTargetIdentity: identity,
          lastCaptureAttemptAt:
            (input.lastCaptureAttemptAt as string | null) ??
            existing?.lastCaptureAttemptAt ??
            null,
          lastSuccessfulProofAt:
            (input.lastSuccessfulProofAt as string | null) ??
            existing?.lastSuccessfulProofAt ??
            null,
          lastSuccessfulCaptureId:
            (input.lastSuccessfulCaptureId as string | null) ??
            existing?.lastSuccessfulCaptureId ??
            null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        state.proofTargets.set(identity, target);
        return target;
      },
    ),
  }));

  return state;
}

function stubFixtureFetch(currentHtml: () => string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      // The public-URL guard resolves hostnames via DNS-over-HTTPS; answer
      // every lookup with a public address so the fixture host resolves.
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        return new Response(
          JSON.stringify({
            Status: 0,
            Answer: [
              { name: "funnel-fixture.example", type: 1, data: "93.184.216.34" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/dns-json" } },
        );
      }

      // The Browserless BQL rendered-proof leg — returns the fixture HTML
      // plus a screenshot, the same payload shape production consumes.
      if (url.startsWith("https://browserless.test/")) {
        return new Response(
          JSON.stringify({
            data: {
              html: { html: currentHtml() },
              screenshot: { base64: SCREENSHOT_B64 },
              url: { url: FIXTURE_URL },
              documentRequests: [],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch,
  );
}

const TEST_ENV = {
  ALLOW_PLATFORM_META_API_FALLBACK: "true",
  META_AD_LIBRARY_TOKEN: "token",
  BROWSERLESS_TOKEN: "test-token",
  BROWSERLESS_BQL_URL: "https://browserless.test/stealth/bql",
  LANDING_PAGE_ARTIFACTS: { put: vi.fn(async () => ({})) },
} as never;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("landing-page extraction funnel (issue #2893)", () => {
  it("runs the real capture→extract→diff pipeline end-to-end: baseline then a CTA+price change emits landing_page_* events", async () => {
    const state = installMocks();
    let html = fixtureHtml("a");
    stubFixtureFetch(() => html);

    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    // --- Scan 1: first capture — establishes the baseline, no diff, no event.
    await runWatchlistManual(TEST_ENV, watchlist);

    expect(state.finishedRuns).toHaveLength(1);
    const run1Funnel = state.finishedRuns[0]!.input.summary
      .landingPageExtractionFunnel as Record<string, unknown>;
    expect(run1Funnel).toMatchObject({
      observations: 1,
      proofCandidates: 1,
      dispatched: 1,
      rendered: 1,
      contentGatePassed: 1,
      fieldsExtracted: 1,
      // Issue #2443: a first-capture baseline is NOT a real diff — it must
      // not count in diffed, and must surface as the documented bail reason.
      diffed: 0,
      eventEmitted: 0,
    });
    expect(run1Funnel.bailReasons).toMatchObject({
      "event_emitted:no_baseline_first_scan": 1,
    });
    const baselineCapture = state.proofCaptures.find(
      (capture) => capture.status === "succeeded",
    );
    expect(baselineCapture).toBeDefined();
    expect(
      (baselineCapture!.extractedFields as Record<string, unknown>).ctaText,
    ).toBe("Shop now");
    expect(
      (baselineCapture!.extractedFields as Record<string, unknown>).priceText,
    ).toBe("Starting at ₹499");
    expect(
      state.events.some((event) =>
        String(event.eventType).startsWith("landing_page_"),
      ),
    ).toBe(false);

    // --- Eight days later: the next scheduled-window scan re-proofs the
    // page (freshness gate: last proof older than the 7-day window), now
    // serving the changed CTA + price fixture.
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    for (const capture of state.proofCaptures) {
      capture.attemptedAt = eightDaysAgo;
      if (capture.succeededAt) capture.succeededAt = eightDaysAgo;
    }
    html = fixtureHtml("b");

    await runWatchlistManual(TEST_ENV, watchlist);

    expect(state.finishedRuns).toHaveLength(2);
    const run2Funnel = state.finishedRuns[1]!.input.summary
      .landingPageExtractionFunnel as Record<string, unknown>;
    expect(run2Funnel).toMatchObject({
      observations: 1,
      proofCandidates: 1,
      dispatched: 1,
      rendered: 1,
      contentGatePassed: 1,
      fieldsExtracted: 1,
      diffed: 1,
      eventEmitted: 1,
    });

    const run2Events = state.events.filter((event) => event.runId === "run-2");
    const landingEventTypes = run2Events
      .map((event) => event.eventType)
      .filter((type) => String(type).startsWith("landing_page_"));
    expect(landingEventTypes).toEqual(
      expect.arrayContaining([
        "landing_page_cta_changed",
        "landing_page_offer_changed",
      ]),
    );
    const ctaEvent = run2Events.find(
      (event) => event.eventType === "landing_page_cta_changed",
    );
    expect(ctaEvent).toMatchObject({ status: "confirmed" });
    expect((ctaEvent!.metadata as Record<string, unknown>).from).toBe(
      "Shop now",
    );
    expect((ctaEvent!.metadata as Record<string, unknown>).to).toBe(
      "Get offer",
    );
    const offerEvent = run2Events.find(
      (event) => event.eventType === "landing_page_offer_changed",
    );
    expect(offerEvent).toMatchObject({ status: "confirmed" });
    expect((offerEvent!.metadata as Record<string, unknown>).from).toBe(
      "Starting at ₹499",
    );
    expect((offerEvent!.metadata as Record<string, unknown>).to).toBe(
      "Starting at ₹899",
    );
  });
});
