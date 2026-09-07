import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  beginWebsiteSiteScan,
  finalizeWebsiteSiteScan,
  getLatestCompleteWebsiteScanBaseline,
  listWebsitePageObservationsForRun,
  listWebsiteSiteScanPagesForRun,
  upsertWebsitePageObservation,
  upsertWebsiteSiteScanPage,
  type BeginWebsiteSiteScanInput,
  type FinalizeWebsiteSiteScanInput,
  type UpsertWebsitePageObservationInput,
  type UpsertWebsiteSiteScanPageInput,
  type WebsiteScanLease,
} from "~/lib/data.server";
import type { WebsitePageObservationSignals } from "~/lib/types";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const LEASE_A: WebsiteScanLease = {
  watchlistId: "watch-1",
  runId: "run-1",
  processingToken: "tok-a",
};

const SIGNALS: WebsitePageObservationSignals = {
  title: "Home",
  metaDescription: "Competitor home page",
  visibleTextHash: "vt-hash-1",
  visibleTextExcerpt: "Visible text excerpt",
  offer: null,
  price: null,
  cta: "Buy now",
  formPresent: false,
};

function beginInput(
  overrides: Partial<BeginWebsiteSiteScanInput> = {},
): BeginWebsiteSiteScanInput {
  return {
    ...LEASE_A,
    rootUrl: "https://competitor.example/",
    pageBudget: 50,
    startedAt: "2026-08-01T01:00:00.000Z",
    ...overrides,
  };
}

function pageInput(
  overrides: Partial<UpsertWebsiteSiteScanPageInput> = {},
): UpsertWebsiteSiteScanPageInput {
  return {
    ...LEASE_A,
    canonicalUrl: "https://competitor.example/",
    discoverySource: "watchlist_seed",
    pageKind: "home",
    stableOrder: 0,
    ...overrides,
  };
}

function observationInput(
  overrides: Partial<UpsertWebsitePageObservationInput> = {},
): UpsertWebsitePageObservationInput {
  return {
    ...LEASE_A,
    canonicalUrl: "https://competitor.example/",
    discoverySource: "watchlist_seed",
    pageKind: "home",
    contentHash: "hash-home",
    excerpt: "Home excerpt",
    proofCaptureId: null,
    fetchStatus: "fetched",
    httpStatus: 200,
    fetchErrorCode: null,
    normalizerVersion: "normalizer-v1",
    signals: SIGNALS,
    observedAt: "2026-08-01T02:00:00.000Z",
    ...overrides,
  };
}

function finalizeInput(
  overrides: Partial<FinalizeWebsiteSiteScanInput> = {},
): FinalizeWebsiteSiteScanInput {
  return {
    ...LEASE_A,
    status: "complete",
    sitemapDocumentCount: 1,
    cursor: "cursor-1",
    inventoryHash: "inventory-hash-1",
    failureCode: null,
    finalizedAt: "2026-08-01T03:00:00.000Z",
    ...overrides,
  };
}

describe("website site scan storage", () => {
  let harness: ReturnType<typeof createSqliteD1>;
  let env: never;

  beforeEach(() => {
    harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0000_auth.sql");
    applyMigration(harness.sqlite, "migrations/0001_app.sql");
    applyMigration(harness.sqlite, "migrations/0007_proof_first_change_alerts.sql");
    applyMigration(harness.sqlite, "migrations/0008_commercial_ad_ingestion_replacement.sql");
    applyMigration(harness.sqlite, "migrations/0009_discovery_query_leases.sql");
    applyMigration(harness.sqlite, "migrations/0022_hot_path_indexes.sql");
    applyMigration(harness.sqlite, "migrations/0047_monitoring_fanout_orchestration.sql");
    // Migration 0007 turns foreign keys off; restore them before seeding.
    harness.sqlite.exec("PRAGMA foreign_keys = ON;");
    applyMigration(harness.sqlite, "migrations/0077_competitor_site_monitoring.sql");
    env = { DB: harness.db } as never;

    harness.sqlite
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
      )
      .run("user-1", "Owner", "owner@example.com", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
    harness.sqlite
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
      )
      .run("user-2", "Other", "other@example.com", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
  });

  afterEach(() => {
    harness.close();
  });

  function seedWatchlist(id: string, userId: string, label: string) {
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist (
           id, user_id, name, target_type, target_id, target_fingerprint,
           target_label, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, userId, `${label} watch`, label, `fp-${label}`, label, "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
  }

  function seedRun(
    id: string,
    watchlistId: string,
    startedAt: string,
    options: { token?: string | null; status?: string } = {},
  ) {
    const token = options.token ?? "tok-a";
    const status = options.status ?? "running";
    harness.sqlite
      .prepare(
        `INSERT INTO watchlist_run (
           id, watchlist_id, trigger_type, status, page_budget, pages_scanned,
           summary_json, started_at, processing_token, created_at, updated_at
         ) VALUES (?, ?, 'scheduled', ?, 50, 0, '{}', ?, ?, ?, ?)`,
      )
      .run(id, watchlistId, status, startedAt, token, startedAt, startedAt);
  }

  function tableCount(table: string): number {
    const row = harness.sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
      total: number;
    };
    return row.total;
  }

  it("derives the workspace from watchlist.user_id and proves the run belongs to the claimed watchlist", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedWatchlist("watch-2", "user-2", "other.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");
    seedRun("run-2", "watch-2", "2026-08-01T02:00:00.000Z", { token: "tok-b" });

    const scan1 = await beginWebsiteSiteScan(env, beginInput());
    expect(scan1.workspaceId).toBe("user-1");

    const scan2 = await beginWebsiteSiteScan(
      env,
      beginInput({
        watchlistId: "watch-2",
        runId: "run-2",
        processingToken: "tok-b",
        startedAt: "2026-08-01T02:00:00.000Z",
      }),
    );
    expect(scan2.workspaceId).toBe("user-2");

    // A run of another watchlist can never be leased through this watchlist:
    // the run/watchlist join proves the match and fails closed.
    await expect(
      beginWebsiteSiteScan(
        env,
        beginInput({ watchlistId: "watch-1", runId: "run-2", processingToken: "tok-b" }),
      ),
    ).rejects.toThrow(/website_scan_lease_run_not_found/);
    expect(tableCount("website_site_scan")).toBe(2);
  });

  it("runs the full current-token lifecycle: begin, inventory, observations, finalize, lists, baseline", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");

    const scan = await beginWebsiteSiteScan(env, beginInput());
    expect(scan.status).toBe("running");
    expect(scan.inventoryComplete).toBe(false);
    expect(scan.processingToken).toBe("tok-a");

    const home = await upsertWebsiteSiteScanPage(env, pageInput());
    const pricing = await upsertWebsiteSiteScanPage(
      env,
      pageInput({ canonicalUrl: "https://competitor.example/pricing", pageKind: "pricing", stableOrder: 1 }),
    );
    expect(home.siteScanId).toBe(scan.id);
    expect(pricing.siteScanId).toBe(scan.id);

    const observed = await upsertWebsitePageObservation(env, observationInput());
    expect(observed.workspaceId).toBe("user-1");
    expect(observed.contentHash).toBe("hash-home");
    expect(observed.signals).toEqual(SIGNALS);

    const finalized = await finalizeWebsiteSiteScan(env, finalizeInput());
    expect(finalized.status).toBe("complete");
    expect(finalized.inventoryComplete).toBe(true);
    expect(finalized.discoveredPageCount).toBe(2);
    expect(finalized.fetchedPageCount).toBe(1);
    expect(finalized.sitemapDocumentCount).toBe(1);
    expect(finalized.scanCursor).toBe("cursor-1");
    expect(finalized.inventoryHash).toBe("inventory-hash-1");
    expect(finalized.finalizedAt).toBe("2026-08-01T03:00:00.000Z");

    const pages = await listWebsiteSiteScanPagesForRun(env, "watch-1", "run-1");
    expect(pages.map((record) => record.canonicalUrl)).toEqual([
      "https://competitor.example/",
      "https://competitor.example/pricing",
    ]);
    const observations = await listWebsitePageObservationsForRun(env, "watch-1", "run-1");
    expect(observations.map((record) => record.canonicalUrl)).toEqual([
      "https://competitor.example/",
    ]);

    const baseline = await getLatestCompleteWebsiteScanBaseline(env, "watch-1");
    expect(baseline).not.toBeNull();
    expect(baseline!.scan.status).toBe("complete");
    expect(baseline!.pages.map((record) => record.canonicalUrl)).toEqual([
      "https://competitor.example/",
      "https://competitor.example/pricing",
    ]);
    expect(baseline!.observations).toHaveLength(1);
  });

  it("rejects every stale-token write with zero mutations", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z", { token: "tok-a" });

    const stale = { watchlistId: "watch-1", runId: "run-1", processingToken: "tok-stale" };
    await expect(beginWebsiteSiteScan(env, beginInput(stale))).rejects.toThrow(/website_scan_lease_stale/);
    await expect(upsertWebsiteSiteScanPage(env, pageInput(stale))).rejects.toThrow(/website_scan_lease_stale/);
    await expect(upsertWebsitePageObservation(env, observationInput(stale))).rejects.toThrow(/website_scan_lease_stale/);
    await expect(finalizeWebsiteSiteScan(env, finalizeInput(stale))).rejects.toThrow(/website_scan_lease_stale/);

    // A run that is no longer running is also stale, even with its old token.
    seedRun("run-2", "watch-1", "2026-08-01T02:00:00.000Z", { token: "tok-b", status: "succeeded" });
    await expect(
      beginWebsiteSiteScan(
        env,
        beginInput({ watchlistId: "watch-1", runId: "run-2", processingToken: "tok-b" }),
      ),
    ).rejects.toThrow(/website_scan_lease_stale/);

    expect(tableCount("website_site_scan")).toBe(0);
    expect(tableCount("website_site_scan_page")).toBe(0);
    expect(tableCount("website_page_observation")).toBe(0);
  });

  it("makes every operation idempotent on exact retry without touching timestamps", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");

    const first = await beginWebsiteSiteScan(env, beginInput());
    const beginRetry = await beginWebsiteSiteScan(env, beginInput());
    expect(beginRetry).toEqual(first);

    const page = await upsertWebsiteSiteScanPage(env, pageInput());
    const pageRetry = await upsertWebsiteSiteScanPage(env, pageInput());
    expect(pageRetry).toEqual(page);

    const obs = await upsertWebsitePageObservation(env, observationInput());
    const obsRetry = await upsertWebsitePageObservation(env, observationInput());
    expect(obsRetry).toEqual(obs);
    expect(obsRetry.updatedAt).toBe(obs.updatedAt);

    const finalized = await finalizeWebsiteSiteScan(env, finalizeInput());
    const finalizeRetry = await finalizeWebsiteSiteScan(env, finalizeInput());
    expect(finalizeRetry).toEqual(finalized);
    expect(finalizeRetry.finalizedAt).toBe(finalized.finalizedAt);

    expect(tableCount("website_site_scan")).toBe(1);
    expect(tableCount("website_site_scan_page")).toBe(1);
    expect(tableCount("website_page_observation")).toBe(1);
  });

  it("never lets a reversed retry regress richer fetched content or finalized truth", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");
    await beginWebsiteSiteScan(env, beginInput());

    // Fetched truth first, then a stale replay claiming a failed fetch.
    const fetched = await upsertWebsitePageObservation(env, observationInput());
    const reversed = await upsertWebsitePageObservation(
      env,
      observationInput({
        fetchStatus: "fetch_failed",
        contentHash: null,
        signals: null,
        normalizerVersion: null,
        httpStatus: null,
        fetchErrorCode: "network_error",
      }),
    );
    expect(reversed).toEqual(fetched);
    expect(reversed.updatedAt).toBe(fetched.updatedAt);
    expect(tableCount("website_page_observation")).toBe(1);

    // A richer retry after a failed first write upgrades in place.
    const failed = await upsertWebsitePageObservation(
      env,
      observationInput({
        canonicalUrl: "https://competitor.example/pricing",
        pageKind: "pricing",
        fetchStatus: "fetch_failed",
        contentHash: null,
        signals: null,
        normalizerVersion: null,
        httpStatus: null,
        fetchErrorCode: "network_error",
      }),
    );
    const recovered = await upsertWebsitePageObservation(
      env,
      observationInput({
        canonicalUrl: "https://competitor.example/pricing",
        pageKind: "pricing",
      }),
    );
    expect(recovered.id).toBe(failed.id);
    expect(recovered.createdAt).toBe(failed.createdAt);
    expect(recovered.fetchStatus).toBe("fetched");
    expect(recovered.contentHash).toBe("hash-home");

    // Finalize is terminal: the same outcome converges, any other outcome
    // conflicts, and the complete manifest stays complete.
    const finalized = await finalizeWebsiteSiteScan(env, finalizeInput());
    expect(finalized.status).toBe("complete");
    await expect(
      finalizeWebsiteSiteScan(
        env,
        finalizeInput({ status: "partial", cursor: "cursor-2", inventoryHash: "hash-2" }),
      ),
    ).rejects.toThrow(/website_scan_finalize_conflict/);
    const afterConflict = await getLatestCompleteWebsiteScanBaseline(env, "watch-1");
    expect(afterConflict!.scan.status).toBe("complete");
    expect(afterConflict!.scan.inventoryComplete).toBe(true);

    // Nothing may be appended once the manifest is finalized.
    await expect(upsertWebsiteSiteScanPage(env, pageInput({ canonicalUrl: "https://competitor.example/after" })))
      .rejects.toThrow(/website_scan_finalized/);
    await expect(
      upsertWebsitePageObservation(
        env,
        observationInput({ canonicalUrl: "https://competitor.example/after" }),
      ),
    ).rejects.toThrow(/website_scan_finalized/);
    expect(tableCount("website_site_scan_page")).toBe(0);
    expect(tableCount("website_page_observation")).toBe(2);
  });

  it("validates finalize outcomes: running cannot finalize, failed needs a code, complete forbids one", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");
    await beginWebsiteSiteScan(env, beginInput());

    await expect(finalizeWebsiteSiteScan(env, finalizeInput({ status: "running" })))
      .rejects.toThrow(/website_scan_finalize_invalid_status/);
    await expect(finalizeWebsiteSiteScan(env, finalizeInput({ status: "failed" })))
      .rejects.toThrow(/website_scan_finalize_requires_failure_code/);
    await expect(finalizeWebsiteSiteScan(env, finalizeInput({ status: "complete", failureCode: "boom" })))
      .rejects.toThrow(/website_scan_finalize_invalid_failure_code/);

    const failed = await finalizeWebsiteSiteScan(
      env,
      finalizeInput({ status: "failed", failureCode: "crawler_crash", cursor: null, inventoryHash: null }),
    );
    expect(failed.status).toBe("failed");
    expect(failed.inventoryComplete).toBe(false);
    expect(failed.failureCode).toBe("crawler_crash");

    // A failed scan never becomes a baseline.
    expect(await getLatestCompleteWebsiteScanBaseline(env, "watch-1")).toBeNull();
  });

  it("represents an empty complete scan through the manifest alone", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");

    await beginWebsiteSiteScan(env, beginInput());
    const finalized = await finalizeWebsiteSiteScan(env, finalizeInput());
    expect(finalized.inventoryComplete).toBe(true);
    expect(finalized.discoveredPageCount).toBe(0);
    expect(finalized.fetchedPageCount).toBe(0);

    const baseline = await getLatestCompleteWebsiteScanBaseline(env, "watch-1");
    expect(baseline).not.toBeNull();
    expect(baseline!.scan.status).toBe("complete");
    expect(baseline!.scan.inventoryComplete).toBe(true);
    expect(baseline!.pages).toEqual([]);
    expect(baseline!.observations).toEqual([]);
  });

  it("keeps the full-inventory baseline independent of how many pages the rotating batch fetched", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");
    await beginWebsiteSiteScan(env, beginInput());

    // A 3-page inventory; only the home page is actually fetched by the batch.
    await upsertWebsiteSiteScanPage(env, pageInput());
    await upsertWebsiteSiteScanPage(env, pageInput({ canonicalUrl: "https://competitor.example/pricing", pageKind: "pricing", stableOrder: 1 }));
    await upsertWebsiteSiteScanPage(env, pageInput({ canonicalUrl: "https://competitor.example/changelog", pageKind: "changelog", stableOrder: 2 }));
    await upsertWebsitePageObservation(env, observationInput());
    await finalizeWebsiteSiteScan(env, finalizeInput());

    const baseline = await getLatestCompleteWebsiteScanBaseline(env, "watch-1");
    expect(baseline!.pages).toHaveLength(3);
    expect(baseline!.observations).toHaveLength(1);
    expect(baseline!.scan.discoveredPageCount).toBe(3);
    expect(baseline!.scan.fetchedPageCount).toBe(1);
  });

  it("excludes partial and failed scans from the baseline entirely", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");
    seedRun("run-2", "watch-1", "2026-08-02T01:00:00.000Z", { token: "tok-b" });
    seedRun("run-3", "watch-1", "2026-08-03T01:00:00.000Z", { token: "tok-c" });

    // run-1: complete with home + pricing.
    await beginWebsiteSiteScan(env, beginInput());
    await upsertWebsiteSiteScanPage(env, pageInput());
    await upsertWebsiteSiteScanPage(env, pageInput({ canonicalUrl: "https://competitor.example/pricing", pageKind: "pricing", stableOrder: 1 }));
    await finalizeWebsiteSiteScan(env, finalizeInput());

    // run-2: partial — only a temp page observed, must never shadow run-1.
    await beginWebsiteSiteScan(
      env,
      beginInput({ watchlistId: "watch-1", runId: "run-2", processingToken: "tok-b", startedAt: "2026-08-02T01:00:00.000Z" }),
    );
    await upsertWebsiteSiteScanPage(
      env,
      pageInput({ watchlistId: "watch-1", runId: "run-2", processingToken: "tok-b", canonicalUrl: "https://competitor.example/temp", pageKind: "landing", stableOrder: 0 }),
    );
    await finalizeWebsiteSiteScan(
      env,
      finalizeInput({ watchlistId: "watch-1", runId: "run-2", processingToken: "tok-b", status: "partial", cursor: null, inventoryHash: null }),
    );

    // run-3: failed — newest run, still must not shadow or leak.
    await beginWebsiteSiteScan(
      env,
      beginInput({ watchlistId: "watch-1", runId: "run-3", processingToken: "tok-c", startedAt: "2026-08-03T01:00:00.000Z" }),
    );
    await finalizeWebsiteSiteScan(
      env,
      finalizeInput({ watchlistId: "watch-1", runId: "run-3", processingToken: "tok-c", status: "failed", failureCode: "crawler_crash", cursor: null, inventoryHash: null }),
    );

    const baseline = await getLatestCompleteWebsiteScanBaseline(env, "watch-1");
    expect(baseline!.scan.watchlistRunId).toBe("run-1");
    expect(baseline!.pages.map((record) => record.canonicalUrl)).toEqual([
      "https://competitor.example/",
      "https://competitor.example/pricing",
    ]);
    expect(baseline!.pages.some((record) => record.canonicalUrl === "https://competitor.example/temp")).toBe(false);

    // Before the partial run, the complete run-1 is still the baseline.
    const beforePartial = await getLatestCompleteWebsiteScanBaseline(env, "watch-1", "run-2");
    expect(beforePartial!.scan.watchlistRunId).toBe("run-1");
  });

  it("selects the latest complete scan and honors beforeRunId", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");
    seedRun("run-2", "watch-1", "2026-08-02T01:00:00.000Z", { token: "tok-b" });

    await beginWebsiteSiteScan(env, beginInput());
    await upsertWebsiteSiteScanPage(env, pageInput({ canonicalUrl: "https://competitor.example/old" }));
    await finalizeWebsiteSiteScan(env, finalizeInput());

    await beginWebsiteSiteScan(
      env,
      beginInput({ watchlistId: "watch-1", runId: "run-2", processingToken: "tok-b", startedAt: "2026-08-02T01:00:00.000Z" }),
    );
    await upsertWebsiteSiteScanPage(env, pageInput({ watchlistId: "watch-1", runId: "run-2", processingToken: "tok-b", canonicalUrl: "https://competitor.example/new" }));
    await finalizeWebsiteSiteScan(
      env,
      finalizeInput({ watchlistId: "watch-1", runId: "run-2", processingToken: "tok-b", sitemapDocumentCount: 2, cursor: "cursor-2", inventoryHash: "hash-2" }),
    );

    const latest = await getLatestCompleteWebsiteScanBaseline(env, "watch-1");
    expect(latest!.scan.watchlistRunId).toBe("run-2");
    expect(latest!.pages.map((record) => record.canonicalUrl)).toEqual([
      "https://competitor.example/new",
    ]);

    const beforeRun2 = await getLatestCompleteWebsiteScanBaseline(env, "watch-1", "run-2");
    expect(beforeRun2!.scan.watchlistRunId).toBe("run-1");
    expect(beforeRun2!.pages.map((record) => record.canonicalUrl)).toEqual([
      "https://competitor.example/old",
    ]);

    // Before the very first run there is no baseline.
    expect(await getLatestCompleteWebsiteScanBaseline(env, "watch-1", "run-1")).toBeNull();
  });

  it("enforces structured-signal bounds and fetched-observation completeness", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");
    await beginWebsiteSiteScan(env, beginInput());

    await expect(
      upsertWebsitePageObservation(
        env,
        observationInput({ excerpt: "x".repeat(1001) }),
      ),
    ).rejects.toThrow(/website_page_observation_excerpt_too_long/);
    await expect(
      upsertWebsitePageObservation(
        env,
        observationInput({
          signals: { ...SIGNALS, title: "t".repeat(12000) },
        }),
      ),
    ).rejects.toThrow(/website_page_observation_signals_too_large/);
    await expect(
      upsertWebsitePageObservation(
        env,
        observationInput({ contentHash: "h".repeat(129) }),
      ),
    ).rejects.toThrow(/website_page_observation_content_hash_too_long/);

    // Fetched observations require the versioned structured snapshot.
    await expect(
      upsertWebsitePageObservation(
        env,
        observationInput({ contentHash: null, signals: null, normalizerVersion: null }),
      ),
    ).rejects.toThrow(/website_page_observation_incomplete/);
    await expect(
      upsertWebsitePageObservation(
        env,
        observationInput({ signals: null, normalizerVersion: null }),
      ),
    ).rejects.toThrow(/website_page_observation_incomplete/);
    await expect(
      upsertWebsitePageObservation(
        env,
        observationInput({ normalizerVersion: null }),
      ),
    ).rejects.toThrow(/website_page_observation_incomplete/);

    // Nothing was written by the rejected calls.
    expect(tableCount("website_page_observation")).toBe(0);
  });

  it("stores failed and skipped fetches with nullable content and signals", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");
    await beginWebsiteSiteScan(env, beginInput());

    const failed = await upsertWebsitePageObservation(
      env,
      observationInput({
        canonicalUrl: "https://competitor.example/blocked",
        pageKind: "landing",
        fetchStatus: "fetch_failed",
        contentHash: null,
        signals: null,
        normalizerVersion: null,
        excerpt: null,
        httpStatus: null,
        fetchErrorCode: "network_error",
      }),
    );
    expect(failed.fetchStatus).toBe("fetch_failed");
    expect(failed.contentHash).toBeNull();
    expect(failed.signals).toBeNull();
    expect(failed.normalizerVersion).toBeNull();
    expect(failed.httpStatus).toBeNull();
    expect(failed.fetchErrorCode).toBe("network_error");

    const skipped = await upsertWebsitePageObservation(
      env,
      observationInput({
        canonicalUrl: "https://competitor.example/budgeted",
        pageKind: "other",
        fetchStatus: "skipped",
        contentHash: null,
        signals: null,
        normalizerVersion: null,
        httpStatus: null,
        fetchErrorCode: "skipped_due_to_budget",
      }),
    );
    expect(skipped.contentHash).toBeNull();
    expect(skipped.signals).toBeNull();

    const records = await listWebsitePageObservationsForRun(env, "watch-1", "run-1");
    expect(records).toHaveLength(2);
  });

  it("keeps scans, pages, and observations isolated across watchlists and workspaces", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedWatchlist("watch-2", "user-2", "other.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");
    seedRun("run-2", "watch-2", "2026-08-02T01:00:00.000Z", { token: "tok-b" });

    const lease2: WebsiteScanLease = { watchlistId: "watch-2", runId: "run-2", processingToken: "tok-b" };
    const sameUrl = "https://competitor.example/pricing";

    await beginWebsiteSiteScan(env, beginInput());
    await upsertWebsiteSiteScanPage(env, pageInput({ canonicalUrl: sameUrl, pageKind: "pricing" }));
    await upsertWebsitePageObservation(env, observationInput({ canonicalUrl: sameUrl, pageKind: "pricing" }));
    await finalizeWebsiteSiteScan(env, finalizeInput());

    await beginWebsiteSiteScan(
      env,
      beginInput({ ...lease2, rootUrl: "https://other.example/", startedAt: "2026-08-02T01:00:00.000Z" }),
    );
    const page2 = await upsertWebsiteSiteScanPage(
      env,
      pageInput({ ...lease2, canonicalUrl: sameUrl, pageKind: "pricing", stableOrder: 1 }),
    );
    const obs2 = await upsertWebsitePageObservation(
      env,
      observationInput({ ...lease2, canonicalUrl: sameUrl, pageKind: "pricing", contentHash: "hash-other" }),
    );
    expect(page2.siteScanId).not.toBe((await getLatestCompleteWebsiteScanBaseline(env, "watch-1"))!.scan.id);
    expect(obs2.workspaceId).toBe("user-2");

    // The same URL in watch-2 is its own page and observation rows.
    expect(tableCount("website_site_scan_page")).toBe(2);
    expect(tableCount("website_page_observation")).toBe(2);

    expect(await listWebsiteSiteScanPagesForRun(env, "watch-2", "run-1")).toEqual([]);
    expect(await listWebsitePageObservationsForRun(env, "watch-1", "run-2")).toEqual([]);

    // watch-2's complete baseline exists once finalized and never leaks into
    // watch-1's listing.
    await finalizeWebsiteSiteScan(
      env,
      finalizeInput({ ...lease2, sitemapDocumentCount: 0, cursor: null, inventoryHash: null }),
    );
    const otherBaseline = await getLatestCompleteWebsiteScanBaseline(env, "watch-2");
    expect(otherBaseline!.scan.workspaceId).toBe("user-2");
    expect(otherBaseline!.pages.map((record) => record.canonicalUrl)).toEqual([sameUrl]);
    const watch1Baseline = await getLatestCompleteWebsiteScanBaseline(env, "watch-1");
    expect(watch1Baseline!.observations.every((record) => record.workspaceId === "user-1")).toBe(true);
  });

  it("rejects writes that skip beginWebsiteSiteScan", async () => {
    seedWatchlist("watch-1", "user-1", "competitor.example");
    seedRun("run-1", "watch-1", "2026-08-01T01:00:00.000Z");

    await expect(upsertWebsiteSiteScanPage(env, pageInput())).rejects.toThrow(/website_scan_missing/);
    await expect(upsertWebsitePageObservation(env, observationInput())).rejects.toThrow(/website_scan_missing/);
    await expect(finalizeWebsiteSiteScan(env, finalizeInput())).rejects.toThrow(/website_scan_missing/);
    expect(tableCount("website_site_scan")).toBe(0);
    expect(tableCount("website_site_scan_page")).toBe(0);
    expect(tableCount("website_page_observation")).toBe(0);
  });
});
