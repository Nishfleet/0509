import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureCurrentEvidenceUsagePeriod,
  grantEvidenceTopUp,
  reconcileStaleEvidenceReservations,
  reserveEvidenceCheck,
  tryFinalizeEvidenceForProofCapture,
} from "~/lib/evidence-usage.server";
import type { AppEnv } from "~/lib/env.server";
import { finishOrchestratedWatchlistRun } from "~/lib/monitoring-fanout.server";
import type { AdRecord, ProofCaptureRecord, WatchEventRecord, WatchlistRecord } from "~/lib/types";
import { createSqliteD1 } from "./helpers/sqlite-d1";

type EvidenceTestEnv = AppEnv & {
  DB: NonNullable<AppEnv["DB"]>;
  sqlite: ReturnType<typeof createSqliteD1>["sqlite"];
};

function createEvidenceEnv(plan = "scout"): EvidenceTestEnv {
  const { db, sqlite } = createSqliteD1();
  sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY);
    CREATE TABLE user_plan (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      dodo_status TEXT,
      dodo_next_billing_at TEXT,
      plan_updated_at TEXT,
      evidence_entitlement_anchor TEXT,
      evidence_entitlement_anchor_source TEXT
    );
    CREATE TABLE watchlist_run (
      id TEXT PRIMARY KEY,
      watchlist_id TEXT NOT NULL DEFAULT '',
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL,
      page_budget INTEGER NOT NULL DEFAULT 3,
      pages_scanned INTEGER NOT NULL DEFAULT 0,
      baseline_from_run_id TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL DEFAULT '2026-06-23T00:00:00.000Z',
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT,
      processing_token TEXT,
      processing_started_at TEXT,
      queued_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      retry_after TEXT,
      workflow_instance_id TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-06-23T00:00:00.000Z',
      updated_at TEXT NOT NULL DEFAULT '2026-06-23T00:00:00.000Z'
    );
    CREATE TABLE monitoring_concurrency_slot (
      slot_index INTEGER PRIMARY KEY,
      holder_run_id TEXT,
      holder_token TEXT,
      holder_mode TEXT,
      leased_at TEXT
    );
    INSERT INTO monitoring_concurrency_slot (slot_index) VALUES (1), (2), (3), (4);
    CREATE TABLE evidence_usage_period (
      id TEXT PRIMARY KEY,
      workspace_user_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      plan_family TEXT NOT NULL,
      included_allowance INTEGER NOT NULL,
      included_consumed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_evidence_usage_period_workspace_start
      ON evidence_usage_period(workspace_user_id, period_start);
    CREATE TABLE evidence_top_up_grant (
      id TEXT PRIMARY KEY,
      workspace_user_id TEXT NOT NULL,
      sku_slug TEXT NOT NULL,
      provider_payment_id TEXT NOT NULL UNIQUE,
      provider_product_id TEXT NOT NULL,
      quantity_granted INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      granted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      catalog_version TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE evidence_top_up_ledger_entry (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      workspace_user_id TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      reservation_id TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE evidence_usage_reservation (
      id TEXT PRIMARY KEY,
      workspace_user_id TEXT NOT NULL,
      usage_period_id TEXT,
      top_up_grant_id TEXT,
      logical_operation_key TEXT NOT NULL UNIQUE,
      quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      reserved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      settled_at TEXT,
      released_at TEXT,
      source TEXT NOT NULL,
      owner_run_id TEXT,
      owner_processing_token TEXT,
      owner_lease_seen_at TEXT,
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE,
      FOREIGN KEY (usage_period_id) REFERENCES evidence_usage_period(id) ON DELETE SET NULL,
      FOREIGN KEY (top_up_grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE SET NULL
    );
    CREATE TABLE proof_usage_credit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credits INTEGER NOT NULL,
      provider_payment_id TEXT,
      granted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE proof_usage_credit_migration (
      legacy_credit_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      workspace_user_id TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      FOREIGN KEY (grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
    );
    INSERT INTO user (id) VALUES ('user-1');
    INSERT INTO user_plan (
      user_id, plan, plan_updated_at, evidence_entitlement_anchor, evidence_entitlement_anchor_source
    ) VALUES ('user-1', '${plan}', '2026-06-23T00:00:00.000Z', '2026-06-23T00:00:00.000Z', 'plan_activation');
  `);

  const batch = db.batch.bind(db);
  let batchQueue = Promise.resolve();
  const serializedDb = {
    ...db,
    batch(statements: Parameters<typeof db.batch>[0]) {
      const next = batchQueue.then(() => batch(statements));
      batchQueue = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  return { DB: serializedDb, sqlite } as EvidenceTestEnv;
}

function createMonitoringEnv() {
  const { db, sqlite } = createSqliteD1();
  sqlite.exec(`
    CREATE TABLE watchlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_fingerprint TEXT NOT NULL,
      target_label TEXT NOT NULL,
      target_country TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_scanned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE watchlist_run (
      id TEXT PRIMARY KEY,
      watchlist_id TEXT NOT NULL,
      status TEXT NOT NULL,
      pages_scanned INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT,
      processing_token TEXT,
      processing_started_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO watchlist (
      id, user_id, name, target_type, target_id, target_fingerprint, target_label,
      is_active, created_at, updated_at
    ) VALUES ('watch-1', 'user-1', 'watch', 'website', 'https://example.com', 'fp-1', 'example', 1,
      '2026-06-23T00:00:00.000Z', '2026-06-23T00:00:00.000Z');
    INSERT INTO watchlist_run (
      id, watchlist_id, status, pages_scanned, summary_json, processing_token,
      processing_started_at, updated_at
    ) VALUES ('run-1', 'watch-1', 'running', 0, '{}', 'token-1',
      '2026-06-23T00:00:00.000Z', '2026-06-23T00:00:00.000Z');
  `);
  return { env: { DB: db } as unknown as AppEnv, sqlite };
}

const manualWatchlist: WatchlistRecord = {
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
  createdAt: "2026-06-23T00:00:00.000Z",
  updatedAt: "2026-06-23T00:00:00.000Z",
};

const manualDirectWebsiteWatchlist: WatchlistRecord = {
  ...manualWatchlist,
  targetId: "https://example.com",
  targetFingerprint: "fp-example",
  targetLabel: "Example",
};

function alertDetail(
  outcome: "definitive_terminal_failure" | "pending_provider_unknown",
) {
  return {
    status: outcome === "definitive_terminal_failure" ? "failed" : "pending",
    outcome,
    claimedByThisRun: true,
    providerAttemptedByThisRun: true,
    duplicate: false,
    source: "current_claim",
  };
}

const manualAd: AdRecord = {
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
  landingPageUrl: "https://example.com/glow",
  adSnapshotUrl: null,
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta_api",
  analysisFields: [],
};

function manualObservation(runId: string) {
  return {
    id: `obs-${runId}`,
    ad_id: "meta-nykaa-1",
    watchlist_run_id: runId,
    landing_page_snapshot_id: null,
    landing_page_url: "https://example.com/glow",
    normalized_headline_hash: "hash-a",
    raw_headline: "Glow serum sale",
    seen_at: "2026-06-23T10:00:00.000Z",
    is_active: 1,
    metadata_json: JSON.stringify({ advertiser: "Nykaa" }),
  };
}

function manualBaselineProof(): ProofCaptureRecord {
  return {
    id: "proof-success",
    proofTargetId: "target-1",
    status: "succeeded",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: "proofs/success.jpeg",
    htmlArtifactKey: "proofs/success.html",
    extractedFields: {
      rawHeadline: "Glow serum sale",
      normalizedHeadline: "glow serum sale",
      normalizedHeadlineHash: "hash-a",
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: true,
    },
    fieldConfidence: { headline: 0.92, ctaText: 0.88, priceText: 0.87 },
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:watch-1",
    attemptedAt: "2026-06-01T00:00:00.000Z",
    succeededAt: "2026-06-01T00:00:01.000Z",
    createdAt: "2026-06-01T00:00:01.000Z",
    updatedAt: "2026-06-01T00:00:01.000Z",
  };
}

function createManualSnapshot() {
  return {
    rawUrl: "https://example.com/glow",
    canonicalUrl: "https://example.com/glow",
    rawHeadline: "Glow serum sale",
    normalizedHeadline: "glow serum sale",
    normalizedHeadlineHash: "hash-a",
    ctaText: "Get offer",
    priceText: "Starting at ₹499",
    formPresent: true,
    captureMethod: "browser_render",
    capturedAt: "2026-06-23T10:00:15.000Z",
    artifactKey: "landing-pages/page.html",
    metadata: {
      htmlArtifactKey: "landing-pages/page.html",
      screenshotArtifactKey: "landing-pages/page.jpeg",
      extractorVersion: "lp-signals-v1",
      extractedFieldConfidence: {
        headline: 0.95,
        ctaText: 0.9,
        priceText: 0.86,
        formPresent: 0.91,
      },
      extractionWarnings: [],
      renderMode: "mobile",
      deviceProfile: "mobile_default",
    },
  };
}

async function installManualRunMocks(input: {
  capture: "success" | "crash" | "null";
  onCapture?: () => void;
  renewLease?: () => boolean;
  createdProofCaptures: Array<Record<string, unknown>>;
  createdCandidates: Array<Record<string, unknown>>;
  createdEvents: WatchEventRecord[];
  deliverWatchlistAlerts: ReturnType<typeof vi.fn>;
  useRealFinishWatchlistRun?: boolean;
}) {
  const createProofCapture = vi.fn().mockImplementation(async (_env, payload) => {
    input.createdProofCaptures.push(payload as Record<string, unknown>);
    return "proof-current";
  });
  const createEventCandidate = vi.fn().mockImplementation(async (_env, payload) => {
    input.createdCandidates.push(payload as Record<string, unknown>);
    return "candidate-1";
  });
  const createWatchEvent = vi.fn().mockImplementation(async (_env, payload) => {
    const event: WatchEventRecord = {
      id: `event-${input.createdEvents.length + 1}`,
      watchlistId: payload.watchlistId,
      runId: payload.runId,
      eventType: payload.eventType,
      status: payload.status ?? "confirmed",
      importanceScore: payload.importanceScore ?? 0,
      adId: payload.adId ?? null,
      baselineFromRunId: payload.baselineFromRunId ?? null,
      candidateId: payload.candidateId ?? null,
      proofCaptureId: payload.proofCaptureId ?? null,
      title: payload.title,
      summary: payload.summary,
      metadata: payload.metadata ?? {},
      confirmedAt: "2026-06-23T10:00:20.000Z",
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: "2026-06-23T10:00:20.000Z",
      createdAt: "2026-06-23T10:00:20.000Z",
    };
    input.createdEvents.push(event);
    return event.id;
  });

  vi.doMock("~/lib/analysis.server", () => ({ buildAnalysisFields: vi.fn(() => []) }));
  vi.doMock("~/lib/creative-text.server", () => ({ captureCreativeText: vi.fn() }));
  const captureLandingPageSnapshot = vi.fn().mockImplementation(async () => {
    input.onCapture?.();
    if (input.capture === "crash") {
      throw new Error("provider capture crashed");
    }
    return input.capture === "null" ? null : createManualSnapshot();
  });
  vi.doMock("~/lib/landing-pages.server", () => ({ captureLandingPageSnapshot }));
  if (input.renewLease) {
    vi.doMock("~/lib/monitoring-fanout.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      renewOrchestratedWatchlistRunLease: vi.fn(async () => input.renewLease?.() ?? false),
    }));
  }
  const searchAdsViaSourceResolver = vi.fn().mockResolvedValue({
    ads: [manualAd],
    nextCursor: null,
    source: "meta_api",
  });
  vi.doMock("~/lib/ad-source.server", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    searchAdsViaSourceResolver,
  }));
  vi.doMock("~/lib/plan.server", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getUserPlan: vi.fn().mockResolvedValue("starter"),
  }));
  vi.doMock("~/lib/delivery.server", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    deliverWatchlistAlerts: input.deliverWatchlistAlerts,
  }));
  vi.doMock("~/lib/data.server", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
    countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
    createAdObservation: vi.fn(),
    createEventCandidate,
    createProofCapture,
    createWatchEvent,
    createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
    ...(input.useRealFinishWatchlistRun ? {} : { finishWatchlistRun: vi.fn() }),
    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-0" }]),
    getUserDeliveryProfile: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      name: "Owner",
    }),
    hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
    hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([manualAd]),
    listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
    listObservationsForRun: vi.fn(async (_env, runId: string) => [manualObservation(runId)]),
    listProofCapturesForTarget: vi.fn().mockResolvedValue([manualBaselineProof()]),
    listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map([["target-1", [manualBaselineProof()]]])),
    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
    listWatchEvents: vi.fn().mockResolvedValue([]),
    listWatchEventsForRun: vi.fn().mockResolvedValue([]),
    logMetaIntegrationStatus: vi.fn(),
    touchWatchlistScanned: vi.fn(),
    upsertAd: vi.fn(),
    upsertProofTarget: vi.fn().mockResolvedValue({
      id: "target-1",
      watchlistId: "watch-1",
      adId: "meta-nykaa-1",
      landingPageUrl: "https://example.com/glow",
      canonicalPageIdentity: "example.com/glow",
      proofTargetIdentity: "watch-1:meta-nykaa-1:example.com/glow",
      lastCaptureAttemptAt: "2026-06-23T10:00:15.000Z",
      lastSuccessfulProofAt: "2026-06-01T00:00:01.000Z",
      lastSuccessfulCaptureId: "proof-success",
      createdAt: "2026-06-01T00:00:01.000Z",
      updatedAt: "2026-06-23T10:00:15.000Z",
    }),
  }));

  return {
    captureLandingPageSnapshot,
    searchAdsViaSourceResolver,
    createProofCapture,
    createWatchEvent,
    createEventCandidate,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/monitoring-fanout.server");
});

describe("monitoring evidence lifecycle acceptance", () => {
  it("releases included quota exactly once when the provider crashes after reservation", async () => {
    const env = createEvidenceEnv();
    const reservation = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "provider-crash-included",
      source: "monitoring",
    });
    expect(reservation).toMatchObject({ ok: true, pool: "included" });

    const providerCheck = async () => {
      throw new Error("provider crashed after evidence reservation");
    };
    await expect(providerCheck()).rejects.toThrow("provider crashed");

    await tryFinalizeEvidenceForProofCapture(env, "provider-crash-included", "failed");
    await tryFinalizeEvidenceForProofCapture(env, "provider-crash-included", "failed");

    expect(
      env.sqlite.prepare(
        "SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = ?",
      ).get("provider-crash-included"),
    ).toEqual({ status: "released" });
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 0,
    });
  });

  it("reconciles a top-up reservation release exactly once", async () => {
    const env = createEvidenceEnv();
    const period = await ensureCurrentEvidenceUsagePeriod(env, "user-1", "scout");
    await grantEvidenceTopUp(env, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "provider-top-up-crash",
      providerProductId: "prod-burst",
      quantityGranted: 2,
    });
    await env.DB.prepare("UPDATE evidence_usage_period SET included_allowance = 0 WHERE id = ?")
      .bind(period.id)
      .run();

    const reservation = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "provider-crash-top-up",
      source: "monitoring",
    });
    expect(reservation).toMatchObject({ ok: true, pool: "top_up" });

    await tryFinalizeEvidenceForProofCapture(env, "provider-crash-top-up", "failed");
    await tryFinalizeEvidenceForProofCapture(env, "provider-crash-top-up", "failed");

    expect(
      env.sqlite.prepare(
        "SELECT quantity_remaining FROM evidence_top_up_grant WHERE provider_payment_id = ?",
      ).get("provider-top-up-crash"),
    ).toEqual({ quantity_remaining: 2 });
    expect(
      env.sqlite.prepare(
        "SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE entry_type = 'release'",
      ).get(),
    ).toEqual({ count: 1 });
  });

  it("keeps the reservation pending and customer artifact absent when finalization storage fails", async () => {
    const env = createEvidenceEnv();
    const reservation = await reserveEvidenceCheck(env, {
      workspaceUserId: "user-1",
      logicalOperationKey: "finalization-storage-failure",
      source: "monitoring",
    });
    expect(reservation).toMatchObject({ ok: true });

    const failingDb = {
      ...env.DB,
      prepare() {
        throw new Error("D1_ERROR: no such table: evidence_usage_reservation");
      },
    } as unknown as NonNullable<AppEnv["DB"]>;
    const internalProofMarkers = ["proof-capture"];
    const finalization = await tryFinalizeEvidenceForProofCapture(
      { ...env, DB: failingDb } as AppEnv,
      "finalization-storage-failure",
      "failed",
    );
    expect(finalization).toBe(false);

    expect(internalProofMarkers).toHaveLength(1);
    expect(
      env.sqlite.prepare(
        "SELECT status FROM evidence_usage_reservation WHERE logical_operation_key = ?",
      ).get("finalization-storage-failure"),
    ).toEqual({ status: "pending" });

    const released = await reconcileStaleEvidenceReservations(env, "2999-01-01T00:00:00.000Z");
    expect(released).toBe(1);
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 0,
    });
  });

  it("refuses terminal success when the watchlist/run completion transaction affects zero rows", async () => {
    const { env, sqlite } = createMonitoringEnv();
    const finalized = await finishOrchestratedWatchlistRun(env, {
      runId: "run-1",
      processingToken: "token-1",
      status: "succeeded",
      pagesScanned: 1,
      summary: { events: 0 },
      touchWatchlistId: "missing-watchlist",
    });

    expect(finalized).toBe(false);
    expect(
      sqlite.prepare("SELECT status, processing_token FROM watchlist_run WHERE id = 'run-1'").get(),
    ).toEqual({ status: "running", processing_token: "token-1" });
    expect(sqlite.prepare("SELECT last_scanned_at FROM watchlist WHERE id = 'watch-1'").get()).toEqual({
      last_scanned_at: null,
    });
  });
});

describe("monitoring evidence lifecycle through runWatchlistManual", () => {
  it.each([
    ["definitive_terminal_failure", "alert_delivery_failed"],
    ["pending_provider_unknown", "alert_delivery_pending_provider_unknown"],
  ] as const)(
    "persists the %s run outcome before propagating the recorded delivery error",
    async (outcome, errorCode) => {
      vi.resetModules();
      const env = createEvidenceEnv();
      env.sqlite.exec(`
        INSERT INTO watchlist_run (id, watchlist_id, status, processing_token)
        VALUES ('run-1', 'watch-1', 'running', NULL);
      `);
      const createdProofCaptures: Array<Record<string, unknown>> = [];
      const createdCandidates: Array<Record<string, unknown>> = [];
      const createdEvents: WatchEventRecord[] = [];
      const deliverWatchlistAlerts = vi.fn().mockResolvedValue({
        attempts: 1,
        channels: ["email"],
        details: [alertDetail(outcome)],
      });
      await installManualRunMocks({
        capture: "success",
        createdProofCaptures,
        createdCandidates,
        createdEvents,
        deliverWatchlistAlerts,
        useRealFinishWatchlistRun: true,
      });
      const { runWatchlistManual } = await import("~/lib/monitoring.server");

      await expect(runWatchlistManual(env, manualWatchlist)).rejects.toThrow(
        outcome === "definitive_terminal_failure"
          ? "definitively failed"
          : "pending provider confirmation",
      );

      const stored = env.sqlite.prepare(`
        SELECT status, error_code, summary_json
        FROM watchlist_run
        WHERE id = 'run-1'
      `).get() as { status: string; error_code: string; summary_json: string };
      expect(stored.status).toBe("failed");
      expect(stored.error_code).toBe(errorCode);
      expect(JSON.parse(stored.summary_json)).toMatchObject({
        sendAttempts: 1,
        sendFailures: outcome === "definitive_terminal_failure" ? 1 : 0,
        sendsTriggered: 0,
      });
    },
  );

  it("does not compensate quota after a Workflow lease is lost during capture", async () => {
    vi.resetModules();
    const env = createEvidenceEnv();
    env.sqlite.exec(`
      INSERT INTO watchlist_run (id, watchlist_id, status, processing_token)
      VALUES ('run-stale-capture', 'watch-1', 'running', 'stale-token');
    `);
    const createdProofCaptures: Array<Record<string, unknown>> = [];
    const createdCandidates: Array<Record<string, unknown>> = [];
    const createdEvents: WatchEventRecord[] = [];
    const deliverWatchlistAlerts = vi.fn().mockResolvedValue({ attempts: 0, channels: [] });
    let leaseActive = true;
    await installManualRunMocks({
      capture: "null",
      onCapture: () => {
        leaseActive = false;
      },
      renewLease: () => leaseActive,
      createdProofCaptures,
      createdCandidates,
      createdEvents,
      deliverWatchlistAlerts,
    });
    const { runWatchlist } = await import("~/lib/monitoring.server");

    await expect(
      runWatchlist(
        env,
        manualWatchlist,
        "manual",
        async () => ({ ads: [manualAd], pagesScanned: 1, degraded: false }),
        {
          existingRunId: "run-stale-capture",
          orchestrationToken: "stale-token",
        },
      ),
    ).rejects.toThrow(/stale orchestrated watchlist run token/i);

    expect(createdProofCaptures).toEqual([]);
    expect(createdCandidates).toEqual([]);
    expect(createdEvents).toEqual([]);
    expect(deliverWatchlistAlerts).not.toHaveBeenCalled();
    expect(env.sqlite.prepare("SELECT status FROM evidence_usage_reservation").all()).toEqual([
      { status: "pending" },
    ]);
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 1,
    });
  });

  it("does not persist proof, event, or delivery artifacts after a provider capture crash", async () => {
    vi.resetModules();
    const env = createEvidenceEnv();
    const createdProofCaptures: Array<Record<string, unknown>> = [];
    const createdCandidates: Array<Record<string, unknown>> = [];
    const createdEvents: WatchEventRecord[] = [];
    const deliverWatchlistAlerts = vi.fn().mockResolvedValue({ attempts: 0, channels: [] });
    await installManualRunMocks({
      capture: "crash",
      createdProofCaptures,
      createdCandidates,
      createdEvents,
      deliverWatchlistAlerts,
    });
    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await expect(runWatchlistManual(env, manualWatchlist)).rejects.toThrow("provider capture crashed");

    expect(createdProofCaptures).toEqual([]);
    expect(createdEvents).toEqual([]);
    expect(deliverWatchlistAlerts).not.toHaveBeenCalled();
    expect(env.sqlite.prepare("SELECT status FROM evidence_usage_reservation").all()).toEqual([
      { status: "released" },
    ]);
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 0,
    });
  });

  it("does not falsely publish a successful proof/event/delivery when finalization storage is unavailable", async () => {
    vi.resetModules();
    const baseEnv = createEvidenceEnv();
    const originalPrepare = baseEnv.DB.prepare.bind(baseEnv.DB);
    const failingDb = {
      ...baseEnv.DB,
      prepare(sql: string) {
        if (/UPDATE\s+evidence_usage_reservation\s+SET\s+status\s*=\s*'settled'/is.test(sql)) {
          throw new Error("D1_ERROR: no such table: evidence_usage_reservation");
        }
        return originalPrepare(sql);
      },
    } as unknown as NonNullable<AppEnv["DB"]>;
    const env = { ...baseEnv, DB: failingDb } as EvidenceTestEnv;
    const createdProofCaptures: Array<Record<string, unknown>> = [];
    const createdCandidates: Array<Record<string, unknown>> = [];
    const createdEvents: WatchEventRecord[] = [];
    const deliverWatchlistAlerts = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    await installManualRunMocks({
      capture: "success",
      createdProofCaptures,
      createdCandidates,
      createdEvents,
      deliverWatchlistAlerts,
    });
    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await expect(runWatchlistManual(env, manualDirectWebsiteWatchlist)).rejects.toThrow(
      "evidence_usage_pending_reconciliation",
    );

    expect(createdProofCaptures).toHaveLength(1);
    expect(createdProofCaptures[0]).toMatchObject({ status: "succeeded" });
    expect(createdCandidates).toEqual([]);
    expect(createdEvents).toEqual([]);
    expect(deliverWatchlistAlerts).not.toHaveBeenCalled();
    expect(env.sqlite.prepare("SELECT status FROM evidence_usage_reservation").all()).toEqual([
      { status: "pending" },
    ]);
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 1,
    });

    const reconciled = await reconcileStaleEvidenceReservations(baseEnv, "2999-01-01T00:00:00.000Z");
    expect(reconciled).toBe(1);
    expect(env.sqlite.prepare("SELECT included_consumed FROM evidence_usage_period").get()).toEqual({
      included_consumed: 0,
    });
  });

  it("keeps a top-up reservation pending through runWatchlistManual and restores the exact grant balance on reconciliation", async () => {
    vi.resetModules();
    const baseEnv = createEvidenceEnv();
    const period = await ensureCurrentEvidenceUsagePeriod(baseEnv, "user-1", "scout");
    await grantEvidenceTopUp(baseEnv, {
      workspaceUserId: "user-1",
      skuSlug: "burst_500_v1",
      providerPaymentId: "manual-top-up-finalize-failure",
      providerProductId: "prod-burst",
      quantityGranted: 2,
    });
    await baseEnv.DB.prepare("UPDATE evidence_usage_period SET included_allowance = 0 WHERE id = ?")
      .bind(period.id)
      .run();

    const originalPrepare = baseEnv.DB.prepare.bind(baseEnv.DB);
    const failingDb = {
      ...baseEnv.DB,
      prepare(sql: string) {
        if (/UPDATE\s+evidence_usage_reservation\s+SET\s+status\s*=\s*'settled'/is.test(sql)) {
          throw new Error("D1_ERROR: no such table: evidence_usage_reservation");
        }
        return originalPrepare(sql);
      },
    } as unknown as NonNullable<AppEnv["DB"]>;
    const env = { ...baseEnv, DB: failingDb } as EvidenceTestEnv;
    const createdProofCaptures: Array<Record<string, unknown>> = [];
    const createdCandidates: Array<Record<string, unknown>> = [];
    const createdEvents: WatchEventRecord[] = [];
    const deliverWatchlistAlerts = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
    await installManualRunMocks({
      capture: "success",
      createdProofCaptures,
      createdCandidates,
      createdEvents,
      deliverWatchlistAlerts,
    });
    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await expect(runWatchlistManual(env, manualDirectWebsiteWatchlist)).rejects.toThrow(
      "evidence_usage_pending_reconciliation",
    );

    expect(createdProofCaptures).toHaveLength(1);
    expect(createdProofCaptures[0]).toMatchObject({ status: "succeeded" });
    expect(createdCandidates).toEqual([]);
    expect(createdEvents).toEqual([]);
    expect(deliverWatchlistAlerts).not.toHaveBeenCalled();
    expect(env.sqlite.prepare("SELECT status FROM evidence_usage_reservation").all()).toEqual([
      { status: "pending" },
    ]);
    expect(
      env.sqlite
        .prepare("SELECT quantity_remaining FROM evidence_top_up_grant WHERE provider_payment_id = ?")
        .get("manual-top-up-finalize-failure"),
    ).toEqual({ quantity_remaining: 1 });

    const reconciled = await reconcileStaleEvidenceReservations(baseEnv, "2999-01-01T00:00:00.000Z");
    expect(reconciled).toBe(1);
    expect(
      env.sqlite
        .prepare("SELECT quantity_remaining FROM evidence_top_up_grant WHERE provider_payment_id = ?")
        .get("manual-top-up-finalize-failure"),
    ).toEqual({ quantity_remaining: 2 });
    expect(
      env.sqlite.prepare("SELECT COUNT(*) AS count FROM evidence_top_up_ledger_entry WHERE entry_type = 'release'").get(),
    ).toEqual({ count: 1 });
  });
});

describe("monitoring plan-tier attribution propagation", () => {
  it("attributes scans and proof captures with the owner's plan family", async () => {
    vi.resetModules();
    const env = createEvidenceEnv("starter");
    env.sqlite.exec(`
      INSERT INTO watchlist_run (id, watchlist_id, status, processing_token)
      VALUES ('run-tier', 'watch-1', 'running', NULL);
    `);
    const createdProofCaptures: Array<Record<string, unknown>> = [];
    const createdCandidates: Array<Record<string, unknown>> = [];
    const createdEvents: WatchEventRecord[] = [];
    const mocks = await installManualRunMocks({
      capture: "success",
      createdProofCaptures,
      createdCandidates,
      createdEvents,
      deliverWatchlistAlerts: vi.fn().mockResolvedValue({
        // Zero attempts / no details = a confirmed-success delivery so
        // runWatchlistManual resolves normally and the assertions on captured
        // tier/route can run; this test is about plan-tier propagation, not
        // alert-delivery outcomes.
        attempts: 0,
        channels: [],
        details: [],
      }),
    });
    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await runWatchlistManual(env, manualWatchlist);

    // Proof-capture landing captures carry the resolved tier + route context.
    expect(mocks.captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        routeContext: "proof_capture",
        planTier: "starter",
      }),
    );
    // The watchlist scan resolver legs carry the same resolved tier.
    expect(mocks.searchAdsViaSourceResolver.mock.calls.length).toBeGreaterThan(0);
    for (const call of mocks.searchAdsViaSourceResolver.mock.calls) {
      expect(call[3]).toMatchObject({ planTier: "starter" });
    }
  });

  it("threads the caller's exact ExecutionContext into proof captures", async () => {
    vi.resetModules();
    const env = createEvidenceEnv("starter");
    env.sqlite.exec(`
      INSERT INTO watchlist_run (id, watchlist_id, status, processing_token)
      VALUES ('run-tier', 'watch-1', 'running', NULL);
    `);
    const createdProofCaptures: Array<Record<string, unknown>> = [];
    const createdCandidates: Array<Record<string, unknown>> = [];
    const createdEvents: WatchEventRecord[] = [];
    const mocks = await installManualRunMocks({
      capture: "success",
      createdProofCaptures,
      createdCandidates,
      createdEvents,
      deliverWatchlistAlerts: vi.fn().mockResolvedValue({
        attempts: 0,
        channels: [],
        details: [],
      }),
    });
    const { runWatchlistManual } = await import("~/lib/monitoring.server");
    const waitUntil = vi.fn();
    const ctx = { waitUntil } as unknown as ExecutionContext;

    // Direct-website watchlist exercises the selective AND direct proof-capture
    // evaluation paths; both must receive the SAME context object (identity,
    // not a copy) so telemetry row writes get real waitUntil background
    // completion in production.
    await runWatchlistManual(env, manualDirectWebsiteWatchlist, {
      executionContext: ctx,
    });

    expect(mocks.captureLandingPageSnapshot.mock.calls.length).toBeGreaterThan(0);
    for (const call of mocks.captureLandingPageSnapshot.mock.calls) {
      expect(call[2]).toMatchObject({
        routeContext: "proof_capture",
        planTier: "starter",
        executionContext: ctx,
      });
    }
  });
});
