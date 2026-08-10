/**
 * Competitor-site monitoring storage foundation.
 *
 * Three durable concepts, all fenced by the run's processing token:
 *
 *   1. website_site_scan — one run-level manifest per watchlist_run. The
 *      workspace id is derived from watchlist.user_id, never caller-supplied.
 *      Completeness lives on the manifest (inventory_complete), never per
 *      observation: a rotating batch cannot prove a full inventory.
 *   2. website_site_scan_page — the full page inventory per scan; a complete
 *      manifest plus these rows is the only removal/addition baseline.
 *   3. website_page_observation — the pages actually fetched by the rotating
 *      batch, with nullable content/signals for failed or skipped fetches.
 *
 * Every write takes a `{watchlistId, runId, processingToken}` lease and
 * executes only while that exact watchlist_run is `running` with that token.
 * A stale or reclaimed token raises a clear error and mutates nothing. All
 * operations are deterministic on retry: exact duplicates converge without
 * touching timestamps, reversed retries never regress finalized status,
 * inventory completeness, the cursor, or richer fetched content.
 *
 * No crawler, orchestration, delivery, or AI behavior lives here.
 */

import {
  ensureDb,
  queryAll,
  queryOne,
} from "~/lib/data/d1.server";
import {
  createStableId,
  nowIso,
  parseJson,
} from "~/lib/data/helpers.server";
import { bindD1Named } from "~/lib/d1-bind.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  WebsitePageDiscoverySource,
  WebsitePageFetchStatus,
  WebsitePageKind,
  WebsitePageObservationRecord,
  WebsitePageObservationSignals,
  WebsiteScanStatus,
  WebsiteSiteScanPageRecord,
  WebsiteSiteScanRecord,
} from "~/lib/types";

/** Lease object every manifest/inventory/observation write must accept. */
export interface WebsiteScanLease {
  watchlistId: string;
  runId: string;
  processingToken: string;
}

export interface BeginWebsiteSiteScanInput extends WebsiteScanLease {
  rootUrl: string;
  /** Rotating-batch page policy; bounded 1..5000. */
  pageBudget: number;
  startedAt?: string;
}

export interface UpsertWebsiteSiteScanPageInput extends WebsiteScanLease {
  canonicalUrl: string;
  discoverySource: WebsitePageDiscoverySource;
  pageKind: WebsitePageKind;
  /** Stable ordering field; deterministic inventory listings. */
  stableOrder: number;
}

export interface UpsertWebsitePageObservationInput extends WebsiteScanLease {
  canonicalUrl: string;
  discoverySource: WebsitePageDiscoverySource;
  pageKind: WebsitePageKind;
  /** Null for failed/skipped fetches; required for fetched observations. */
  contentHash?: string | null;
  excerpt?: string | null;
  proofCaptureId?: string | null;
  fetchStatus: WebsitePageFetchStatus;
  httpStatus?: number | null;
  fetchErrorCode?: string | null;
  /** Versions the structured signals; required for fetched observations. */
  normalizerVersion?: string | null;
  /** Bounded versioned structured snapshot; required for fetched ones. */
  signals?: WebsitePageObservationSignals | null;
  observedAt?: string;
}

export interface FinalizeWebsiteSiteScanInput extends WebsiteScanLease {
  /** Final lifecycle status; `running` cannot be finalized to. */
  status: WebsiteScanStatus;
  sitemapDocumentCount?: number;
  cursor?: string | null;
  inventoryHash?: string | null;
  /** Required when status is `failed`. */
  failureCode?: string | null;
  finalizedAt?: string;
}

/** A complete manifest, its full inventory (possibly zero rows), and the
 * fetched observations of that run — the removal/addition baseline. */
export interface WebsiteSiteScanBaseline {
  scan: WebsiteSiteScanRecord;
  pages: WebsiteSiteScanPageRecord[];
  observations: WebsitePageObservationRecord[];
}

const MAX_ROOT_URL_LENGTH = 2048;
const MAX_CANONICAL_URL_LENGTH = 2048;
const MAX_CONTENT_HASH_LENGTH = 128;
const MAX_EXCERPT_LENGTH = 1000;
const MAX_FETCH_ERROR_CODE_LENGTH = 64;
const MAX_NORMALIZER_VERSION_LENGTH = 64;
const MAX_SIGNALS_JSON_LENGTH = 12000;
const MAX_PAGE_BUDGET = 5000;
const MIN_PAGE_BUDGET = 1;
const MAX_SCAN_CURSOR_LENGTH = 512;
const MAX_INVENTORY_HASH_LENGTH = 128;
const MAX_FAILURE_CODE_LENGTH = 64;

interface WebsiteSiteScanRow {
  id: string;
  workspace_id: string;
  watchlist_id: string;
  watchlist_run_id: string;
  root_url: string;
  status: WebsiteScanStatus;
  inventory_complete: number;
  discovered_page_count: number;
  sitemap_document_count: number;
  fetched_page_count: number;
  page_budget: number;
  scan_cursor: string | null;
  inventory_hash: string | null;
  failure_code: string | null;
  processing_token: string;
  started_at: string;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WebsiteSiteScanPageRow {
  id: string;
  site_scan_id: string;
  canonical_url: string;
  discovery_source: WebsitePageDiscoverySource;
  page_kind: WebsitePageKind;
  stable_order: number;
  created_at: string;
  updated_at: string;
}

interface WebsitePageObservationRow {
  id: string;
  workspace_id: string;
  watchlist_id: string;
  watchlist_run_id: string;
  canonical_url: string;
  discovery_source: WebsitePageDiscoverySource;
  page_kind: WebsitePageKind;
  content_hash: string | null;
  excerpt: string | null;
  proof_capture_id: string | null;
  fetch_status: WebsitePageFetchStatus;
  http_status: number | null;
  fetch_error_code: string | null;
  normalizer_version: string | null;
  signals_json: string | null;
  observed_at: string;
  created_at: string;
  updated_at: string;
}

function toWebsiteSiteScanRecord(row: WebsiteSiteScanRow): WebsiteSiteScanRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    watchlistId: row.watchlist_id,
    watchlistRunId: row.watchlist_run_id,
    rootUrl: row.root_url,
    status: row.status,
    inventoryComplete: row.inventory_complete === 1,
    discoveredPageCount: row.discovered_page_count,
    sitemapDocumentCount: row.sitemap_document_count,
    fetchedPageCount: row.fetched_page_count,
    pageBudget: row.page_budget,
    scanCursor: row.scan_cursor,
    inventoryHash: row.inventory_hash,
    failureCode: row.failure_code,
    processingToken: row.processing_token,
    startedAt: row.started_at,
    finalizedAt: row.finalized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWebsiteSiteScanPageRecord(
  row: WebsiteSiteScanPageRow,
): WebsiteSiteScanPageRecord {
  return {
    id: row.id,
    siteScanId: row.site_scan_id,
    canonicalUrl: row.canonical_url,
    discoverySource: row.discovery_source,
    pageKind: row.page_kind,
    stableOrder: row.stable_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWebsitePageObservationRecord(
  row: WebsitePageObservationRow,
): WebsitePageObservationRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    watchlistId: row.watchlist_id,
    watchlistRunId: row.watchlist_run_id,
    canonicalUrl: row.canonical_url,
    discoverySource: row.discovery_source,
    pageKind: row.page_kind,
    contentHash: row.content_hash,
    excerpt: row.excerpt,
    proofCaptureId: row.proof_capture_id,
    fetchStatus: row.fetch_status,
    httpStatus: row.http_status,
    fetchErrorCode: row.fetch_error_code,
    normalizerVersion: row.normalizer_version,
    signals: parseJson<WebsitePageObservationSignals | null>(row.signals_json, null),
    observedAt: row.observed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Prove the caller holds the current lease on the run and derive the
 * workspace from watchlist.user_id (never trusted from callers). The join
 * proves watchlist_run.watchlist_id matches the claimed watchlist.
 * Returns the owning workspace id.
 */
async function resolveWebsiteScanLease(
  env: AppEnv,
  lease: WebsiteScanLease,
): Promise<string> {
  const row = await queryOne<{
    workspace_id: string;
    status: string;
    processing_token: string | null;
  }>(
    env,
    `
      SELECT wl.user_id AS workspace_id, wr.status, wr.processing_token
      FROM watchlist wl
      INNER JOIN watchlist_run wr ON wr.watchlist_id = wl.id
      WHERE wl.id = ? AND wr.id = ?
    `,
    lease.watchlistId,
    lease.runId,
  );
  if (!row) {
    throw new Error(
      "website_scan_lease_run_not_found: no watchlist_run for the claimed watchlist",
    );
  }
  if (row.status !== "running") {
    throw new Error(
      `website_scan_lease_stale: watchlist_run is not running (${row.status})`,
    );
  }
  if (row.processing_token !== lease.processingToken) {
    throw new Error("website_scan_lease_stale: processing token mismatch");
  }
  return row.workspace_id;
}

async function getManifestRowForRun(
  env: AppEnv,
  watchlistId: string,
  runId: string,
): Promise<WebsiteSiteScanRow | null> {
  return queryOne<WebsiteSiteScanRow>(
    env,
    `
      SELECT *
      FROM website_site_scan
      WHERE watchlist_id = ? AND watchlist_run_id = ?
    `,
    watchlistId,
    runId,
  );
}

function assertBoundedUrl(value: string, maxLength: number, errorCode: string) {
  if (!value || value.length === 0 || value.length > maxLength) {
    throw new Error(`${errorCode}: expected 1..${maxLength} characters`);
  }
}

/**
 * Begin (or converge on) the run's scan manifest. Idempotent: replaying the
 * same begin returns the existing manifest unchanged; a manifest fenced by a
 * different token fails. Only creates `running` manifests.
 */
export async function beginWebsiteSiteScan(
  env: AppEnv,
  input: BeginWebsiteSiteScanInput,
): Promise<WebsiteSiteScanRecord> {
  const workspaceId = await resolveWebsiteScanLease(env, input);
  assertBoundedUrl(input.rootUrl, MAX_ROOT_URL_LENGTH, "website_site_scan_root_url_too_long");
  if (
    !Number.isInteger(input.pageBudget) ||
    input.pageBudget < MIN_PAGE_BUDGET ||
    input.pageBudget > MAX_PAGE_BUDGET
  ) {
    throw new Error(
      `website_site_scan_budget_out_of_range: expected ${MIN_PAGE_BUDGET}..${MAX_PAGE_BUDGET}`,
    );
  }

  const id = await createStableId("website_site_scan", [
    input.watchlistId,
    input.runId,
  ]);
  const timestamp = nowIso();
  const startedAt = input.startedAt ?? timestamp;

  await bindD1Named(
    ensureDb(env).prepare(`
      INSERT INTO website_site_scan (
        id,
        workspace_id,
        watchlist_id,
        watchlist_run_id,
        root_url,
        status,
        inventory_complete,
        discovered_page_count,
        sitemap_document_count,
        fetched_page_count,
        page_budget,
        scan_cursor,
        inventory_hash,
        failure_code,
        processing_token,
        started_at,
        finalized_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'running', 0, 0, 0, 0, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?)
      ON CONFLICT(watchlist_run_id) DO NOTHING
    `),
    [
      ["websiteSiteScan.id", id],
      ["websiteSiteScan.workspaceId", workspaceId],
      ["websiteSiteScan.watchlistId", input.watchlistId],
      ["websiteSiteScan.runId", input.runId],
      ["websiteSiteScan.rootUrl", input.rootUrl],
      ["websiteSiteScan.pageBudget", input.pageBudget],
      ["websiteSiteScan.processingToken", input.processingToken],
      ["websiteSiteScan.startedAt", startedAt],
      ["websiteSiteScan.createdAt", timestamp],
      ["websiteSiteScan.updatedAt", timestamp],
    ],
  ).run();

  const row = await getManifestRowForRun(env, input.watchlistId, input.runId);
  if (!row) {
    throw new Error("website_site_scan missing after begin");
  }
  if (row.processing_token !== input.processingToken) {
    throw new Error("website_scan_lease_stale: manifest fenced by another token");
  }
  return toWebsiteSiteScanRecord(row);
}

/**
 * Upsert one inventory page for the run's scan. Requires an existing,
 * not-yet-finalized manifest under the current lease. Exact retries converge
 * on the existing row without touching timestamps.
 */
export async function upsertWebsiteSiteScanPage(
  env: AppEnv,
  input: UpsertWebsiteSiteScanPageInput,
): Promise<WebsiteSiteScanPageRecord> {
  await resolveWebsiteScanLease(env, input);
  assertBoundedUrl(input.canonicalUrl, MAX_CANONICAL_URL_LENGTH, "website_site_scan_page_url_too_long");
  if (!Number.isInteger(input.stableOrder) || input.stableOrder < 0) {
    throw new Error("website_site_scan_page_order_invalid: expected integer >= 0");
  }

  const manifest = await getManifestRowForRun(env, input.watchlistId, input.runId);
  if (!manifest) {
    throw new Error("website_scan_missing: beginWebsiteSiteScan before writing pages");
  }
  if (manifest.processing_token !== input.processingToken) {
    throw new Error("website_scan_lease_stale: manifest fenced by another token");
  }
  if (manifest.finalized_at !== null) {
    throw new Error("website_scan_finalized: inventory is immutable after finalize");
  }

  const id = await createStableId("website_site_scan_page", [
    input.watchlistId,
    input.runId,
    input.canonicalUrl,
  ]);
  const existing = await queryOne<WebsiteSiteScanPageRow>(
    env,
    `
      SELECT *
      FROM website_site_scan_page
      WHERE site_scan_id = ? AND canonical_url = ?
    `,
    manifest.id,
    input.canonicalUrl,
  );
  if (existing) {
    const exactDuplicate =
      existing.discovery_source === input.discoverySource &&
      existing.page_kind === input.pageKind &&
      existing.stable_order === input.stableOrder;
    if (exactDuplicate) {
      return toWebsiteSiteScanPageRecord(existing);
    }
    const timestamp = nowIso();
    await bindD1Named(
      ensureDb(env).prepare(`
        UPDATE website_site_scan_page
        SET discovery_source = ?,
            page_kind = ?,
            stable_order = ?,
            updated_at = ?
        WHERE id = ?
      `),
      [
        ["websiteSiteScanPage.discoverySource", input.discoverySource],
        ["websiteSiteScanPage.pageKind", input.pageKind],
        ["websiteSiteScanPage.stableOrder", input.stableOrder],
        ["websiteSiteScanPage.updatedAt", timestamp],
        ["websiteSiteScanPage.id", existing.id],
      ],
    ).run();
    const row = await queryOne<WebsiteSiteScanPageRow>(
      env,
      "SELECT * FROM website_site_scan_page WHERE id = ?",
      existing.id,
    );
    if (!row) {
      throw new Error(`website_site_scan_page ${existing.id} vanished after update`);
    }
    return toWebsiteSiteScanPageRecord(row);
  }

  const timestamp = nowIso();
  await bindD1Named(
    ensureDb(env).prepare(`
      INSERT INTO website_site_scan_page (
        id,
        site_scan_id,
        canonical_url,
        discovery_source,
        page_kind,
        stable_order,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    [
      ["websiteSiteScanPage.id", id],
      ["websiteSiteScanPage.siteScanId", manifest.id],
      ["websiteSiteScanPage.canonicalUrl", input.canonicalUrl],
      ["websiteSiteScanPage.discoverySource", input.discoverySource],
      ["websiteSiteScanPage.pageKind", input.pageKind],
      ["websiteSiteScanPage.stableOrder", input.stableOrder],
      ["websiteSiteScanPage.createdAt", timestamp],
      ["websiteSiteScanPage.updatedAt", timestamp],
    ],
  ).run();

  const row = await queryOne<WebsiteSiteScanPageRow>(
    env,
    "SELECT * FROM website_site_scan_page WHERE id = ?",
    id,
  );
  if (!row) {
    throw new Error(`website_site_scan_page ${id} vanished after upsert`);
  }
  return toWebsiteSiteScanPageRecord(row);
}

/** Null-safe field equality for observation retry detection. */
function observationFieldsEqual(
  row: WebsitePageObservationRow,
  candidate: {
    discoverySource: WebsitePageDiscoverySource;
    pageKind: WebsitePageKind;
    contentHash: string | null;
    excerpt: string | null;
    proofCaptureId: string | null;
    fetchStatus: WebsitePageFetchStatus;
    httpStatus: number | null;
    fetchErrorCode: string | null;
    normalizerVersion: string | null;
    signalsJson: string | null;
    observedAt: string;
  },
) {
  return (
    row.discovery_source === candidate.discoverySource &&
    row.page_kind === candidate.pageKind &&
    row.content_hash === candidate.contentHash &&
    row.excerpt === candidate.excerpt &&
    row.proof_capture_id === candidate.proofCaptureId &&
    row.fetch_status === candidate.fetchStatus &&
    row.http_status === candidate.httpStatus &&
    row.fetch_error_code === candidate.fetchErrorCode &&
    row.normalizer_version === candidate.normalizerVersion &&
    row.signals_json === candidate.signalsJson &&
    row.observed_at === candidate.observedAt
  );
}

/** A retry that would erase richer fetched content is a regression. */
function observationRegresses(
  row: WebsitePageObservationRow,
  candidate: {
    contentHash: string | null;
    signalsJson: string | null;
    fetchStatus: WebsitePageFetchStatus;
  },
) {
  return (
    (row.content_hash !== null && candidate.contentHash === null) ||
    (row.signals_json !== null && candidate.signalsJson === null) ||
    (row.fetch_status === "fetched" && candidate.fetchStatus !== "fetched")
  );
}

/**
 * Upsert one observation for a URL fetched by the rotating batch. Requires
 * an existing, not-yet-finalized manifest under the current lease.
 *
 * Monotonic on retry: exact duplicates converge without touching timestamps;
 * a reversed retry carrying less content than the stored row never overwrites
 * the richer truth. A failed/skipped first write may be upgraded in place by
 * a later fetched retry.
 */
export async function upsertWebsitePageObservation(
  env: AppEnv,
  input: UpsertWebsitePageObservationInput,
): Promise<WebsitePageObservationRecord> {
  await resolveWebsiteScanLease(env, input);
  assertBoundedUrl(input.canonicalUrl, MAX_CANONICAL_URL_LENGTH, "website_page_observation_url_too_long");
  if (input.httpStatus !== null && input.httpStatus !== undefined) {
    if (
      !Number.isInteger(input.httpStatus) ||
      input.httpStatus < 100 ||
      input.httpStatus > 599
    ) {
      throw new Error("website_page_observation_http_status_invalid: expected 100..599");
    }
  }
  if (input.excerpt !== null && input.excerpt !== undefined && input.excerpt.length > MAX_EXCERPT_LENGTH) {
    throw new Error(
      `website_page_observation_excerpt_too_long: max ${MAX_EXCERPT_LENGTH} characters`,
    );
  }
  if (
    input.contentHash !== null &&
    input.contentHash !== undefined &&
    input.contentHash.length > MAX_CONTENT_HASH_LENGTH
  ) {
    throw new Error(
      `website_page_observation_content_hash_too_long: max ${MAX_CONTENT_HASH_LENGTH} characters`,
    );
  }
  if (
    input.fetchErrorCode !== null &&
    input.fetchErrorCode !== undefined &&
    input.fetchErrorCode.length > MAX_FETCH_ERROR_CODE_LENGTH
  ) {
    throw new Error(
      `website_page_observation_fetch_error_code_too_long: max ${MAX_FETCH_ERROR_CODE_LENGTH} characters`,
    );
  }
  if (
    input.normalizerVersion !== null &&
    input.normalizerVersion !== undefined &&
    input.normalizerVersion.length > MAX_NORMALIZER_VERSION_LENGTH
  ) {
    throw new Error(
      `website_page_observation_normalizer_version_too_long: max ${MAX_NORMALIZER_VERSION_LENGTH} characters`,
    );
  }

  const signalsJson = input.signals ? JSON.stringify(input.signals) : null;
  if (signalsJson !== null && signalsJson.length > MAX_SIGNALS_JSON_LENGTH) {
    throw new Error(
      `website_page_observation_signals_too_large: max ${MAX_SIGNALS_JSON_LENGTH} characters`,
    );
  }

  // Fetched observations require the versioned structured snapshot.
  if (input.fetchStatus === "fetched") {
    if (input.contentHash == null) {
      throw new Error("website_page_observation_incomplete: fetched requires contentHash");
    }
    if (input.normalizerVersion == null) {
      throw new Error("website_page_observation_incomplete: fetched requires normalizerVersion");
    }
    if (input.signals == null) {
      throw new Error("website_page_observation_incomplete: fetched requires signals");
    }
  }

  const manifest = await getManifestRowForRun(env, input.watchlistId, input.runId);
  if (!manifest) {
    throw new Error("website_scan_missing: beginWebsiteSiteScan before writing observations");
  }
  if (manifest.processing_token !== input.processingToken) {
    throw new Error("website_scan_lease_stale: manifest fenced by another token");
  }
  if (manifest.finalized_at !== null) {
    throw new Error("website_scan_finalized: observations are immutable after finalize");
  }

  const id = await createStableId("website_page_observation", [
    input.watchlistId,
    input.runId,
    input.canonicalUrl,
  ]);
  const timestamp = nowIso();
  const observedAt = input.observedAt ?? timestamp;
  const proofCaptureId = input.proofCaptureId ?? null;
  const contentHash = input.contentHash ?? null;
  const excerpt = input.excerpt ?? null;
  const httpStatus = input.httpStatus ?? null;
  const fetchErrorCode = input.fetchErrorCode ?? null;
  const normalizerVersion = input.normalizerVersion ?? null;

  const candidate = {
    discoverySource: input.discoverySource,
    pageKind: input.pageKind,
    contentHash,
    excerpt,
    proofCaptureId,
    fetchStatus: input.fetchStatus,
    httpStatus,
    fetchErrorCode,
    normalizerVersion,
    signalsJson,
    observedAt,
  };

  const existing = await queryOne<WebsitePageObservationRow>(
    env,
    `
      SELECT *
      FROM website_page_observation
      WHERE watchlist_id = ? AND watchlist_run_id = ? AND canonical_url = ?
    `,
    input.watchlistId,
    input.runId,
    input.canonicalUrl,
  );
  if (existing) {
    if (observationFieldsEqual(existing, candidate)) {
      return toWebsitePageObservationRecord(existing);
    }
    // A reversed retry must never regress richer fetched content.
    if (observationRegresses(existing, candidate)) {
      return toWebsitePageObservationRecord(existing);
    }
    await bindD1Named(
      ensureDb(env).prepare(`
        UPDATE website_page_observation
        SET discovery_source = ?,
            page_kind = ?,
            content_hash = ?,
            excerpt = ?,
            proof_capture_id = ?,
            fetch_status = ?,
            http_status = ?,
            fetch_error_code = ?,
            normalizer_version = ?,
            signals_json = ?,
            observed_at = ?,
            updated_at = ?
        WHERE id = ?
      `),
      [
        ["websitePageObservation.discoverySource", input.discoverySource],
        ["websitePageObservation.pageKind", input.pageKind],
        ["websitePageObservation.contentHash", contentHash, "null"],
        ["websitePageObservation.excerpt", excerpt, "null"],
        ["websitePageObservation.proofCaptureId", proofCaptureId, "null"],
        ["websitePageObservation.fetchStatus", input.fetchStatus],
        ["websitePageObservation.httpStatus", httpStatus, "null"],
        ["websitePageObservation.fetchErrorCode", fetchErrorCode, "null"],
        ["websitePageObservation.normalizerVersion", normalizerVersion, "null"],
        ["websitePageObservation.signalsJson", signalsJson, "null"],
        ["websitePageObservation.observedAt", observedAt],
        ["websitePageObservation.updatedAt", timestamp],
        ["websitePageObservation.id", existing.id],
      ],
    ).run();
    const row = await queryOne<WebsitePageObservationRow>(
      env,
      "SELECT * FROM website_page_observation WHERE id = ?",
      existing.id,
    );
    if (!row) {
      throw new Error(`website_page_observation ${existing.id} vanished after update`);
    }
    return toWebsitePageObservationRecord(row);
  }

  await bindD1Named(
    ensureDb(env).prepare(`
      INSERT INTO website_page_observation (
        id,
        workspace_id,
        watchlist_id,
        watchlist_run_id,
        canonical_url,
        discovery_source,
        page_kind,
        content_hash,
        excerpt,
        proof_capture_id,
        fetch_status,
        http_status,
        fetch_error_code,
        normalizer_version,
        signals_json,
        observed_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    [
      ["websitePageObservation.id", id],
      ["websitePageObservation.workspaceId", manifest.workspace_id],
      ["websitePageObservation.watchlistId", input.watchlistId],
      ["websitePageObservation.runId", input.runId],
      ["websitePageObservation.canonicalUrl", input.canonicalUrl],
      ["websitePageObservation.discoverySource", input.discoverySource],
      ["websitePageObservation.pageKind", input.pageKind],
      ["websitePageObservation.contentHash", contentHash, "null"],
      ["websitePageObservation.excerpt", excerpt, "null"],
      ["websitePageObservation.proofCaptureId", proofCaptureId, "null"],
      ["websitePageObservation.fetchStatus", input.fetchStatus],
      ["websitePageObservation.httpStatus", httpStatus, "null"],
      ["websitePageObservation.fetchErrorCode", fetchErrorCode, "null"],
      ["websitePageObservation.normalizerVersion", normalizerVersion, "null"],
      ["websitePageObservation.signalsJson", signalsJson, "null"],
      ["websitePageObservation.observedAt", observedAt],
      ["websitePageObservation.createdAt", timestamp],
      ["websitePageObservation.updatedAt", timestamp],
    ],
  ).run();

  const row = await queryOne<WebsitePageObservationRow>(
    env,
    "SELECT * FROM website_page_observation WHERE id = ?",
    id,
  );
  if (!row) {
    throw new Error(`website_page_observation ${id} vanished after upsert`);
  }
  return toWebsitePageObservationRecord(row);
}

/**
 * Finalize the scan under the current lease — the only operation that may
 * mark inventory complete or move the manifest out of `running`.
 *
 * Commit-style: the caller's declared outcome (status/cursor/inventory hash/
 * failure code) is stored first, then discovered/fetched counts are recomputed
 * from the actual rows. Replays of the same outcome converge on the stored
 * manifest; a different outcome after finalize raises a conflict. Because a
 * partial manifest's status is stored verbatim, a stale write can never
 * promote it to complete — only the current lease's explicit finalize can.
 */
export async function finalizeWebsiteSiteScan(
  env: AppEnv,
  input: FinalizeWebsiteSiteScanInput,
): Promise<WebsiteSiteScanRecord> {
  await resolveWebsiteScanLease(env, input);

  if (input.status === "running") {
    throw new Error("website_scan_finalize_invalid_status: cannot finalize to running");
  }
  if (input.status === "failed" && !input.failureCode) {
    throw new Error("website_scan_finalize_requires_failure_code: failed scans need one");
  }
  if (input.status !== "failed" && input.failureCode) {
    throw new Error("website_scan_finalize_invalid_failure_code: only failed scans carry one");
  }
  if (
    input.cursor !== null &&
    input.cursor !== undefined &&
    input.cursor.length > MAX_SCAN_CURSOR_LENGTH
  ) {
    throw new Error(
      `website_scan_finalize_cursor_too_long: max ${MAX_SCAN_CURSOR_LENGTH} characters`,
    );
  }
  if (
    input.inventoryHash !== null &&
    input.inventoryHash !== undefined &&
    input.inventoryHash.length > MAX_INVENTORY_HASH_LENGTH
  ) {
    throw new Error(
      `website_scan_finalize_inventory_hash_too_long: max ${MAX_INVENTORY_HASH_LENGTH} characters`,
    );
  }
  if (
    input.failureCode !== null &&
    input.failureCode !== undefined &&
    input.failureCode.length > MAX_FAILURE_CODE_LENGTH
  ) {
    throw new Error(
      `website_scan_finalize_failure_code_too_long: max ${MAX_FAILURE_CODE_LENGTH} characters`,
    );
  }
  const sitemapDocumentCount = input.sitemapDocumentCount ?? 0;
  if (!Number.isInteger(sitemapDocumentCount) || sitemapDocumentCount < 0) {
    throw new Error("website_scan_finalize_count_invalid: sitemapDocumentCount must be integer >= 0");
  }

  const manifest = await getManifestRowForRun(env, input.watchlistId, input.runId);
  if (!manifest) {
    throw new Error("website_scan_missing: beginWebsiteSiteScan before finalizing");
  }
  if (manifest.processing_token !== input.processingToken) {
    throw new Error("website_scan_lease_stale: manifest fenced by another token");
  }

  const cursor = input.cursor ?? null;
  const inventoryHash = input.inventoryHash ?? null;
  const failureCode = input.failureCode ?? null;

  if (manifest.finalized_at !== null) {
    // Finalize is terminal: the stored outcome is the only truth. Replays
    // that match it converge without touching timestamps; any different
    // outcome fails without mutation, so a reversed retry cannot regress a
    // finalized status, inventory completeness, cursor, or richer content.
    const exactRetry =
      manifest.status === input.status &&
      manifest.scan_cursor === cursor &&
      manifest.inventory_hash === inventoryHash &&
      manifest.failure_code === failureCode &&
      manifest.sitemap_document_count === sitemapDocumentCount;
    if (exactRetry) {
      return toWebsiteSiteScanRecord(manifest);
    }
    throw new Error(
      "website_scan_finalize_conflict: scan already finalized with a different outcome",
    );
  }

  // Commit-style: store the caller's declared outcome first, then recompute
  // counts from the actual rows so a partial manifest is stored as partial.
  const timestamp = nowIso();
  const finalizedAt = input.finalizedAt ?? timestamp;
  const inventoryComplete = input.status === "complete" ? 1 : 0;

  await bindD1Named(
    ensureDb(env).prepare(`
      UPDATE website_site_scan
      SET status = ?,
          inventory_complete = ?,
          sitemap_document_count = ?,
          scan_cursor = ?,
          inventory_hash = ?,
          failure_code = ?,
          finalized_at = ?,
          updated_at = ?
      WHERE id = ?
    `),
    [
      ["websiteSiteScan.status", input.status],
      ["websiteSiteScan.inventoryComplete", inventoryComplete],
      ["websiteSiteScan.sitemapDocumentCount", sitemapDocumentCount],
      ["websiteSiteScan.scanCursor", cursor, "null"],
      ["websiteSiteScan.inventoryHash", inventoryHash, "null"],
      ["websiteSiteScan.failureCode", failureCode, "null"],
      ["websiteSiteScan.finalizedAt", finalizedAt],
      ["websiteSiteScan.updatedAt", timestamp],
      ["websiteSiteScan.id", manifest.id],
    ],
  ).run();

  // Recompute counts from the actual rows so the stored manifest always
  // reflects truth, then fail loudly if the recompute ever contradicts the
  // stored finalized outcome (a stored-complete scan must have a stored
  // inventory_complete; a stored non-complete status stays non-complete).
  const inventoryCount = await queryOne<{ total: number }>(
    env,
    "SELECT COUNT(*) AS total FROM website_site_scan_page WHERE site_scan_id = ?",
    manifest.id,
  );
  const fetchedCount = await queryOne<{ total: number }>(
    env,
    `
      SELECT COUNT(*) AS total
      FROM website_page_observation
      WHERE watchlist_id = ? AND watchlist_run_id = ? AND fetch_status = 'fetched'
    `,
    input.watchlistId,
    input.runId,
  );
  await bindD1Named(
    ensureDb(env).prepare(`
      UPDATE website_site_scan
      SET discovered_page_count = ?,
          fetched_page_count = ?
      WHERE id = ?
    `),
    [
      ["websiteSiteScan.discoveredPageCount", inventoryCount?.total ?? 0],
      ["websiteSiteScan.fetchedPageCount", fetchedCount?.total ?? 0],
      ["websiteSiteScan.id", manifest.id],
    ],
  ).run();

  const row = await getManifestRowForRun(env, input.watchlistId, input.runId);
  if (!row) {
    throw new Error("website_site_scan vanished after finalize");
  }
  return toWebsiteSiteScanRecord(row);
}

/** The scan's full inventory rows, in stable order. */
export async function listWebsiteSiteScanPagesForRun(
  env: AppEnv,
  watchlistId: string,
  runId: string,
): Promise<WebsiteSiteScanPageRecord[]> {
  const rows = await queryAll<WebsiteSiteScanPageRow>(
    env,
    `
      SELECT p.*
      FROM website_site_scan_page p
      INNER JOIN website_site_scan s ON s.id = p.site_scan_id
      WHERE s.watchlist_id = ? AND s.watchlist_run_id = ?
      ORDER BY p.stable_order ASC, p.canonical_url ASC
    `,
    watchlistId,
    runId,
  );

  return rows.map(toWebsiteSiteScanPageRecord);
}

/** Observations of the pages actually fetched by the run's rotating batch. */
export async function listWebsitePageObservationsForRun(
  env: AppEnv,
  watchlistId: string,
  runId: string,
): Promise<WebsitePageObservationRecord[]> {
  const rows = await queryAll<WebsitePageObservationRow>(
    env,
    `
      SELECT *
      FROM website_page_observation
      WHERE watchlist_id = ? AND watchlist_run_id = ?
      ORDER BY canonical_url ASC
    `,
    watchlistId,
    runId,
  );

  return rows.map(toWebsitePageObservationRecord);
}

/**
 * The most recent complete scan strictly before `beforeRunId` (by run start
 * time), or the most recent complete scan when `beforeRunId` is omitted.
 * Partial and failed scans are excluded entirely, so they can never become or
 * shadow a complete removal/addition baseline. Returns null when no complete
 * scan exists; a complete scan with zero inventory rows still returns a
 * baseline (empty `pages`).
 */
export async function getLatestCompleteWebsiteScanBaseline(
  env: AppEnv,
  watchlistId: string,
  beforeRunId?: string,
): Promise<WebsiteSiteScanBaseline | null> {
  const anchorRunId = beforeRunId ?? null;
  const scan = await queryOne<WebsiteSiteScanRow>(
    env,
    `
      SELECT ws.*
      FROM website_site_scan ws
      INNER JOIN watchlist_run wr ON wr.id = ws.watchlist_run_id
      WHERE ws.watchlist_id = ?
        AND ws.status = 'complete'
        AND (
          ? IS NULL
          OR wr.started_at < (
            SELECT wr2.started_at
            FROM watchlist_run wr2
            WHERE wr2.id = ?
          )
        )
      ORDER BY wr.started_at DESC, ws.watchlist_run_id DESC
      LIMIT 1
    `,
    watchlistId,
    anchorRunId,
    anchorRunId,
  );
  if (!scan) {
    return null;
  }

  const pages = await queryAll<WebsiteSiteScanPageRow>(
    env,
    `
      SELECT *
      FROM website_site_scan_page
      WHERE site_scan_id = ?
      ORDER BY stable_order ASC, canonical_url ASC
    `,
    scan.id,
  );
  const observations = await queryAll<WebsitePageObservationRow>(
    env,
    `
      SELECT *
      FROM website_page_observation
      WHERE watchlist_id = ? AND watchlist_run_id = ?
      ORDER BY canonical_url ASC
    `,
    watchlistId,
    scan.watchlist_run_id,
  );

  return {
    scan: toWebsiteSiteScanRecord(scan),
    pages: pages.map(toWebsiteSiteScanPageRecord),
    observations: observations.map(toWebsitePageObservationRecord),
  };
}
