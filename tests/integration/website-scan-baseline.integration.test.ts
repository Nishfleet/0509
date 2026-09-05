import { describe, expect, it } from "vitest";

import { getLatestCompleteWebsiteScanBaseline } from "~/lib/data/watchlist-site-pages.server";

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
 * `getLatestCompleteWebsiteScanBaseline` is the snapshot read the whole
 * site-monitoring diff hangs off: whatever it returns becomes the "before"
 * against which page additions and removals are declared. A wrong baseline
 * does not error — it silently invents or suppresses customer-visible change
 * events.
 *
 * Its correctness is entirely SQL: a join to `watchlist_run` for the ordering
 * clock, a `? IS NULL OR started_at < (subquery)` anchor whose NULL branch only
 * behaves under real SQLite parameter binding, and a status filter that must
 * exclude partial and failed scans. None of that is observable through a mocked
 * D1 binding, so it is asserted here against the real one.
 */

async function seedScan(options: {
  workspaceId: string;
  watchlistId: string;
  runId: string;
  status: "running" | "complete" | "partial" | "failed";
  id?: string;
}) {
  const id = options.id ?? uid("scan");
  const complete = options.status === "complete";
  await db()
    .prepare(
      `INSERT INTO website_site_scan (
         id, workspace_id, watchlist_id, watchlist_run_id, root_url, status,
         inventory_complete, page_budget, failure_code, processing_token,
         started_at, finalized_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'https://example.test/', ?, ?, 25, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      options.workspaceId,
      options.watchlistId,
      options.runId,
      options.status,
      complete ? 1 : 0,
      options.status === "failed" ? "fetch_failed" : null,
      `token_${id}`,
      ISO_T0,
      options.status === "running" ? null : ISO_T0,
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

async function seedWorkspaceAndWatchlist() {
  const workspaceId = await seedUser();
  const watchlistId = await seedWatchlist(workspaceId);
  return { workspaceId, watchlistId };
}

describe("getLatestCompleteWebsiteScanBaseline against real D1", () => {
  it("returns null when the watchlist has never completed a scan", async () => {
    const { watchlistId } = await seedWorkspaceAndWatchlist();
    expect(await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId)).toBeNull();
  });

  it("returns the most recent complete scan by run start time", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const oldRun = await seedRun(watchlistId, { startedAt: "2026-02-01T00:00:00.000Z" });
    const newRun = await seedRun(watchlistId, { startedAt: "2026-03-01T00:00:00.000Z" });
    await seedScan({ workspaceId, watchlistId, runId: oldRun, status: "complete" });
    const newest = await seedScan({
      workspaceId,
      watchlistId,
      runId: newRun,
      status: "complete",
    });

    const baseline = await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId);
    expect(baseline?.scan.id).toBe(newest);
    expect(baseline?.scan.watchlistRunId).toBe(newRun);
  });

  it("orders by run start time, not by insertion order", async () => {
    // The newest row is inserted FIRST and given the OLDER run clock. A query
    // that fell back to rowid/created_at order would return the wrong baseline
    // here and be indistinguishable from correct in the previous test.
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const laterRun = await seedRun(watchlistId, { startedAt: "2026-05-01T00:00:00.000Z" });
    const earlierRun = await seedRun(watchlistId, { startedAt: "2026-04-01T00:00:00.000Z" });
    const expected = await seedScan({
      workspaceId,
      watchlistId,
      runId: laterRun,
      status: "complete",
    });
    await seedScan({ workspaceId, watchlistId, runId: earlierRun, status: "complete" });

    const baseline = await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId);
    expect(baseline?.scan.id).toBe(expected);
  });

  it("never lets a partial, failed or running scan become the baseline", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const completeRun = await seedRun(watchlistId, { startedAt: "2026-02-01T00:00:00.000Z" });
    const partialRun = await seedRun(watchlistId, { startedAt: "2026-03-01T00:00:00.000Z" });
    const failedRun = await seedRun(watchlistId, { startedAt: "2026-04-01T00:00:00.000Z" });
    const runningRun = await seedRun(watchlistId, { startedAt: "2026-05-01T00:00:00.000Z" });
    const complete = await seedScan({
      workspaceId,
      watchlistId,
      runId: completeRun,
      status: "complete",
    });
    // All three of these are NEWER than the complete scan, so a missing status
    // filter shows up as the wrong id rather than as no result.
    await seedScan({ workspaceId, watchlistId, runId: partialRun, status: "partial" });
    await seedScan({ workspaceId, watchlistId, runId: failedRun, status: "failed" });
    await seedScan({ workspaceId, watchlistId, runId: runningRun, status: "running" });

    const baseline = await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId);
    expect(baseline?.scan.id).toBe(complete);
    expect(baseline?.scan.status).toBe("complete");
  });

  it("anchors strictly before the given run when beforeRunId is supplied", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const priorRun = await seedRun(watchlistId, { startedAt: "2026-02-01T00:00:00.000Z" });
    const currentRun = await seedRun(watchlistId, { startedAt: "2026-03-01T00:00:00.000Z" });
    const prior = await seedScan({
      workspaceId,
      watchlistId,
      runId: priorRun,
      status: "complete",
    });
    const current = await seedScan({
      workspaceId,
      watchlistId,
      runId: currentRun,
      status: "complete",
    });

    // Without the anchor the current run is its own baseline — the diff would
    // always be empty and no change would ever be reported.
    expect(
      (await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId))?.scan.id,
    ).toBe(current);
    expect(
      (await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId, currentRun))?.scan.id,
    ).toBe(prior);
    // Nothing precedes the earliest run.
    expect(
      await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId, priorRun),
    ).toBeNull();
  });

  it("ignores another watchlist's complete scans", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const otherWatchlistId = await seedWatchlist(workspaceId);
    const otherRun = await seedRun(otherWatchlistId, {
      startedAt: "2026-09-01T00:00:00.000Z",
    });
    await seedScan({
      workspaceId,
      watchlistId: otherWatchlistId,
      runId: otherRun,
      status: "complete",
    });

    expect(await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId)).toBeNull();
  });

  it("returns the scan's inventory in stable_order, then canonical_url", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const runId = await seedRun(watchlistId, { startedAt: "2026-02-01T00:00:00.000Z" });
    const scanId = await seedScan({ workspaceId, watchlistId, runId, status: "complete" });
    // Inserted out of order, and with a tie on stable_order to pin the
    // secondary sort key.
    await seedScanPage(scanId, "https://example.test/zeta", 2);
    await seedScanPage(scanId, "https://example.test/beta", 1);
    await seedScanPage(scanId, "https://example.test/alpha", 1);

    const baseline = await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId);
    expect(baseline?.pages.map((page) => page.canonicalUrl)).toEqual([
      "https://example.test/alpha",
      "https://example.test/beta",
      "https://example.test/zeta",
    ]);
  });

  it("treats a complete scan with an empty inventory as a real baseline", async () => {
    // Documented contract: zero inventory rows is a valid complete inventory,
    // not a missing baseline. Collapsing the two would report every page of the
    // next scan as newly added.
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const runId = await seedRun(watchlistId, { startedAt: "2026-02-01T00:00:00.000Z" });
    const scanId = await seedScan({ workspaceId, watchlistId, runId, status: "complete" });

    const baseline = await getLatestCompleteWebsiteScanBaseline(appEnv, watchlistId);
    expect(baseline).not.toBeNull();
    expect(baseline?.scan.id).toBe(scanId);
    expect(baseline?.pages).toEqual([]);
    expect(baseline?.observations).toEqual([]);
  });
});
