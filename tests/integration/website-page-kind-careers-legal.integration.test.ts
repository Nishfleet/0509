import { describe, expect, it } from "vitest";

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
 * Q4 (#1385): `careers` and `legal` are first-class `page_kind` values. The
 * only thing standing between the new kinds and a silent write failure is the
 * CHECK constraint on `website_site_scan_page.page_kind` and
 * `website_page_observation.page_kind`. Migration 0082 expands both CHECKs to
 * accept the new values (expand-only — every old value is still accepted).
 *
 * A mocked D1 binding cannot see a CHECK constraint, so this asserts against
 * the real one: the new kinds write and read back, an unknown kind is still
 * rejected, and a pre-existing old kind still writes (the expansion did not
 * narrow the vocabulary).
 */

async function seedScan(options: {
  workspaceId: string;
  watchlistId: string;
  runId: string;
  id?: string;
}) {
  const id = options.id ?? uid("scan");
  await db()
    .prepare(
      `INSERT INTO website_site_scan (
         id, workspace_id, watchlist_id, watchlist_run_id, root_url, status,
         inventory_complete, page_budget, failure_code, processing_token,
         started_at, finalized_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'https://example.test/', 'complete', 1, 25, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(id, options.workspaceId, options.watchlistId, options.runId, `token_${id}`, ISO_T0, ISO_T0, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedScanPage(siteScanId: string, canonicalUrl: string, pageKind: string, stableOrder: number) {
  const id = uid("page");
  await db()
    .prepare(
      `INSERT INTO website_site_scan_page (
         id, site_scan_id, canonical_url, discovery_source, page_kind,
         stable_order, created_at, updated_at
       ) VALUES (?, ?, ?, 'sitemap_content', ?, ?, ?, ?)`,
    )
    .bind(id, siteScanId, canonicalUrl, pageKind, stableOrder, ISO_T0, ISO_T0)
    .run();
  return id;
}

async function seedObservation(options: {
  workspaceId: string;
  watchlistId: string;
  runId: string;
  canonicalUrl: string;
  pageKind: string;
  id?: string;
}) {
  const id = options.id ?? uid("obs");
  await db()
    .prepare(
      `INSERT INTO website_page_observation (
         id, workspace_id, watchlist_id, watchlist_run_id, canonical_url,
         discovery_source, page_kind, content_hash, excerpt, proof_capture_id,
         fetch_status, http_status, fetch_error_code, normalizer_version,
         signals_json, observed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'sitemap_content', ?, ?, NULL, NULL,
         'fetched', 200, NULL, 'fullsite-watch-v1', NULL, ?, ?, ?)`,
    )
    .bind(
      id,
      options.workspaceId,
      options.watchlistId,
      options.runId,
      options.canonicalUrl,
      options.pageKind,
      `hash_${id}`,
      ISO_T0,
      ISO_T0,
      ISO_T0,
    )
    .run();
  return id;
}

async function seedWorkspaceAndWatchlist() {
  const workspaceId = await seedUser();
  const watchlistId = await seedWatchlist(workspaceId);
  return { workspaceId, watchlistId };
}

describe("website_site_scan_page.page_kind accepts careers and legal (migration 0082)", () => {
  it("writes and reads back the new first-class kinds", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const runId = await seedRun(watchlistId);
    const scanId = await seedScan({ workspaceId, watchlistId, runId });

    await seedScanPage(scanId, "https://example.test/careers", "careers", 0);
    await seedScanPage(scanId, "https://example.test/legal/privacy", "legal", 1);

    const rows = await db()
      .prepare(
        `SELECT canonical_url, page_kind
         FROM website_site_scan_page
         WHERE site_scan_id = ?
         ORDER BY stable_order`,
      )
      .bind(scanId)
      .all<{ canonical_url: string; page_kind: string }>();
    expect(rows.results.map((row) => row.page_kind)).toEqual(["careers", "legal"]);
  });

  it("still accepts the pre-existing kinds (expansion did not narrow)", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const runId = await seedRun(watchlistId);
    const scanId = await seedScan({ workspaceId, watchlistId, runId });

    await seedScanPage(scanId, "https://example.test/about", "about", 0);
    await seedScanPage(scanId, "https://example.test/other", "other", 1);

    const rows = await db()
      .prepare(
        `SELECT page_kind FROM website_site_scan_page WHERE site_scan_id = ? ORDER BY stable_order`,
      )
      .bind(scanId)
      .all<{ page_kind: string }>();
    expect(rows.results.map((row) => row.page_kind)).toEqual(["about", "other"]);
  });

  it("rejects an unknown kind (CHECK still enforced)", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const runId = await seedRun(watchlistId);
    const scanId = await seedScan({ workspaceId, watchlistId, runId });

    await expect(
      seedScanPage(scanId, "https://example.test/newsletter", "newsletter", 0),
    ).rejects.toThrow();
  });
});

describe("website_page_observation.page_kind accepts careers and legal (migration 0082)", () => {
  it("writes and reads back the new first-class kinds", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const runId = await seedRun(watchlistId);

    await seedObservation({
      workspaceId,
      watchlistId,
      runId,
      canonicalUrl: "https://example.test/careers",
      pageKind: "careers",
    });
    await seedObservation({
      workspaceId,
      watchlistId,
      runId,
      canonicalUrl: "https://example.test/legal/terms",
      pageKind: "legal",
    });

    const rows = await db()
      .prepare(
        `SELECT canonical_url, page_kind
         FROM website_page_observation
         WHERE watchlist_id = ? AND watchlist_run_id = ?
         ORDER BY canonical_url`,
      )
      .bind(watchlistId, runId)
      .all<{ canonical_url: string; page_kind: string }>();
    expect(rows.results.map((row) => row.page_kind).sort()).toEqual(["careers", "legal"]);
  });

  it("rejects an unknown kind (CHECK still enforced)", async () => {
    const { workspaceId, watchlistId } = await seedWorkspaceAndWatchlist();
    const runId = await seedRun(watchlistId);

    await expect(
      seedObservation({
        workspaceId,
        watchlistId,
        runId,
        canonicalUrl: "https://example.test/newsletter",
        pageKind: "newsletter",
      }),
    ).rejects.toThrow();
  });
});
