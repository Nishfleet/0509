import { describe, expect, it } from "vitest";

import { emitWebsitePageChangeEvents } from "~/lib/competitor-site-monitor.server";
import { listWatchEventsForRun } from "~/lib/data/watch-events.server";
import { getLatestCompleteWebsiteScanBaseline } from "~/lib/data/watchlist-site-pages.server";
import type { WebsitePageObservationSignals } from "~/lib/types";

import {
  appEnv,
  db,
  ISO_T0,
  seedRun,
  seedUser,
  seedWatchlist,
  uid,
} from "./fixtures";

/**
 * EPIC #1367 Q2 — website_page_* emission against real D1.
 *
 * The node suites mock the binding, so they cannot see the 0077 CHECKs on
 * `website_page_observation` / `watch_event`, SQLite's `IS ?` NULL matching
 * inside `getLatestCompleteWebsiteScanBaseline`, or `createWatchEvent`'s
 * write path. This file applies the repo's real migrations and asserts both
 * the READ (prior observations + current observations) and the WRITE
 * (watch_event rows with metadata.from / metadata.to).
 */

const SIGNALS: WebsitePageObservationSignals = {
  title: "Home",
  metaDescription: "Competitor home page",
  visibleTextHash: "vt-hash-1",
  visibleTextExcerpt: "Visible text excerpt",
  offer: "$19/mo",
  price: null,
  cta: "Buy now",
  formPresent: false,
};

async function seedScan(options: {
  workspaceId: string;
  watchlistId: string;
  runId: string;
  status: "complete" | "partial";
  id?: string;
}) {
  const id = options.id ?? uid("scan");
  await db()
    .prepare(
      `INSERT INTO website_site_scan (
         id, workspace_id, watchlist_id, watchlist_run_id, root_url, status,
         inventory_complete, page_budget, failure_code, processing_token,
         started_at, finalized_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'https://example.test/', ?, ?, 25, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      options.workspaceId,
      options.watchlistId,
      options.runId,
      options.status,
      options.status === "complete" ? 1 : 0,
      `token_${id}`,
      ISO_T0,
      ISO_T0,
      ISO_T0,
      ISO_T0,
    )
    .run();
  return id;
}

async function seedScanPage(siteScanId: string, canonicalUrl: string, stableOrder: number) {
  const id = uid("page");
  await db()
    .prepare(
      `INSERT INTO website_site_scan_page (
         id, site_scan_id, canonical_url, discovery_source, page_kind,
         stable_order, created_at, updated_at
       ) VALUES (?, ?, ?, 'sitemap_content', 'other', ?, ?, ?)`,
    )
    .bind(id, siteScanId, canonicalUrl, stableOrder, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedObservation(options: {
  workspaceId: string;
  watchlistId: string;
  runId: string;
  canonicalUrl: string;
  signals: WebsitePageObservationSignals;
  contentHash: string;
}) {
  const id = uid("obs");
  await db()
    .prepare(
      `INSERT INTO website_page_observation (
         id, workspace_id, watchlist_id, watchlist_run_id, canonical_url,
         discovery_source, page_kind, content_hash, excerpt, proof_capture_id,
         fetch_status, http_status, fetch_error_code, normalizer_version,
         signals_json, observed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'sitemap_content', 'other', ?, ?, NULL,
         'fetched', 200, NULL, 'competitor-page-normalizer-v1', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      options.workspaceId,
      options.watchlistId,
      options.runId,
      options.canonicalUrl,
      options.contentHash,
      options.signals.visibleTextExcerpt,
      JSON.stringify(options.signals),
      ISO_T0,
      ISO_T0,
      ISO_T0,
    )
    .run();
  return id;
}

describe("website_page_* emission against real D1", () => {
  it("reads prior+current observations and writes alertable watch_event rows", async () => {
    const workspaceId = await seedUser();
    const watchlistId = await seedWatchlist(workspaceId);
    const priorRun = await seedRun(watchlistId, { startedAt: "2026-04-01T00:00:00.000Z" });
    const currentRun = await seedRun(watchlistId, { startedAt: "2026-05-01T00:00:00.000Z" });

    const priorScan = await seedScan({
      workspaceId,
      watchlistId,
      runId: priorRun,
      status: "complete",
    });
    const currentScan = await seedScan({
      workspaceId,
      watchlistId,
      runId: currentRun,
      status: "complete",
    });

    await seedScanPage(priorScan, "https://example.test/", 0);
    await seedScanPage(priorScan, "https://example.test/about", 1);
    await seedScanPage(currentScan, "https://example.test/", 0);
    await seedScanPage(currentScan, "https://example.test/pricing", 1);

    await seedObservation({
      workspaceId,
      watchlistId,
      runId: priorRun,
      canonicalUrl: "https://example.test/",
      signals: SIGNALS,
      contentHash: "hash-home-prior",
    });
    await seedObservation({
      workspaceId,
      watchlistId,
      runId: priorRun,
      canonicalUrl: "https://example.test/about",
      signals: { ...SIGNALS, title: "About", cta: null, offer: null },
      contentHash: "hash-about-prior",
    });
    await seedObservation({
      workspaceId,
      watchlistId,
      runId: currentRun,
      canonicalUrl: "https://example.test/",
      signals: {
        ...SIGNALS,
        title: "Homesite",
        metaDescription: "Changed meta",
        cta: "Get started",
        formPresent: true,
      },
      contentHash: "hash-home-current",
    });
    await seedObservation({
      workspaceId,
      watchlistId,
      runId: currentRun,
      canonicalUrl: "https://example.test/pricing",
      signals: { ...SIGNALS, title: "Pricing", offer: "$29/mo" },
      contentHash: "hash-pricing-current",
    });

    const baseline = await getLatestCompleteWebsiteScanBaseline(
      appEnv,
      watchlistId,
      currentRun,
    );
    expect(baseline?.scan.watchlistRunId).toBe(priorRun);
    expect(baseline?.observations).toHaveLength(2);

    const { eventIds } = await emitWebsitePageChangeEvents(appEnv, {
      watchlistId,
      runId: currentRun,
      inventoryComplete: true,
      captureAt: "2026-05-01T00:00:00.000Z",
    });
    expect(eventIds.length).toBe(3);

    const events = await listWatchEventsForRun(appEnv, watchlistId, currentRun);
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "website_page_added",
      "website_page_changed",
      "website_page_removed",
    ]);

    const added = events.find((event) => event.eventType === "website_page_added");
    expect(added?.metadata.from).toBe("");
    expect(added?.metadata.to).toBe("https://example.test/pricing");

    const removed = events.find((event) => event.eventType === "website_page_removed");
    expect(removed?.metadata.from).toBe("https://example.test/about");
    expect(removed?.metadata.to).toBe("");

    const changed = events.find((event) => event.eventType === "website_page_changed");
    expect(changed?.metadata.from).toBe("Buy now");
    expect(changed?.metadata.to).toBe("Get started");
    expect(changed?.metadata.field).toBe("cta");
    expect(changed?.baselineFromRunId).toBe(priorRun);

    expect(events.some((event) => event.metadata.field === "title")).toBe(false);
    expect(events.some((event) => event.metadata.field === "meta")).toBe(false);
    expect(events.some((event) => event.metadata.field === "form")).toBe(false);
  });
});
