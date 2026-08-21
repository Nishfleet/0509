/**
 * Ad / discovery / landing-page-snapshot D1 persistence.
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Core ad upsert/hydrate/list/analysis-field writes live in
 * `~/lib/ad-persistence.server`; this leaf adds the DB-guard wrappers,
 * landing-page snapshots, and discovery cache/log/provider-state tables.
 */

import { buildLandingPageAnalysisFields } from "~/lib/analysis.server";
import {
  hydrateAdsWithPersistedCreatives as hydrateAdsWithPersistedCreativesImpl,
  replaceAnalysisFields,
  upsertAd as upsertAdImpl,
} from "~/lib/ad-persistence.server";
import {
  execute as run,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  createId,
  jsonValue,
  nowIso,
  parseJson,
} from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import type {
  AdRecord,
  AdDiscoveryProvider,
  DiscoveryCacheStatus,
  DiscoveryFailureClass,
  DiscoveryFetchStatus,
  DiscoveryRouteContext,
  MetaIntegrationStatus,
  SearchResponse,
} from "~/lib/types";

export { listAdsByIds, replaceAnalysisFields } from "~/lib/ad-persistence.server";

interface DiscoveryCacheEntryRow {
  cache_key: string;
  provider: AdDiscoveryProvider;
  route_context: DiscoveryRouteContext;
  query_fingerprint: string;
  country: string;
  cursor: string | null;
  payload_json: string;
  fetched_at: string;
  expires_at: string;
  browser_ms_used: number | null;
  created_at: string;
  updated_at: string;
}

interface DiscoveryProviderStateRow {
  provider: AdDiscoveryProvider;
  status: MetaIntegrationStatus["status"];
  failure_class: DiscoveryFailureClass | null;
  summary: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  metadata_json: string | null;
  updated_at: string;
}

function isMissingTableError(error: unknown, tableName: string) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("no such table") && message.includes(tableName);
}

function isAdDiscoverySource(value: unknown): value is SearchResponse["source"] {
  return (
    value === "meta" ||
    value === "meta_api" ||
    value === "meta_library_browser" ||
    value === "external"
  );
}

function parseDiscoveryCachePayload(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Partial<SearchResponse>;
  if (
    !Array.isArray(candidate.ads) ||
    (candidate.nextCursor !== null && typeof candidate.nextCursor !== "string") ||
    !isAdDiscoverySource(candidate.source)
  ) {
    return null;
  }

  return candidate as SearchResponse;
}

export async function hydrateAdsWithPersistedCreatives(env: AppEnv, ads: AdRecord[]) {
  if (!env.DB) {
    return ads;
  }

  return hydrateAdsWithPersistedCreativesImpl(env, ads);
}

export async function upsertAd(env: AppEnv, ad: AdRecord) {
  if (!env.DB) {
    console.warn(
      `[data.server] upsertAd called without a D1 binding; ad ${ad.metaAdId} was NOT persisted. ` +
        `Check wrangler.jsonc and the deploy environment.`,
    );
    return;
  }

  await upsertAdImpl(env, ad);
}

export async function createLandingPageSnapshot(
  env: AppEnv,
  snapshot: NonNullable<AdRecord["landingPage"]>,
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO landing_page_snapshot (
        id,
        raw_url,
        canonical_url,
        raw_headline,
        normalized_headline,
        normalized_headline_hash,
        capture_method,
        artifact_key,
        metadata_json,
        cta_text,
        price_text,
        form_present,
        ocr_text,
        translated_text,
        captured_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `,
    id,
    snapshot.rawUrl,
    snapshot.canonicalUrl,
    snapshot.rawHeadline,
    snapshot.normalizedHeadline,
    snapshot.normalizedHeadlineHash,
    snapshot.captureMethod,
    snapshot.artifactKey ?? null,
    jsonValue(snapshot.metadata ?? null),
    snapshot.ctaText ?? null,
    snapshot.priceText ?? null,
    typeof snapshot.formPresent === "boolean" ? (snapshot.formPresent ? 1 : 0) : null,
    snapshot.capturedAt,
    timestamp,
  );

  await replaceAnalysisFields(env, "landing_page", id, buildLandingPageAnalysisFields(snapshot));

  return id;
}

export async function upsertDiscoveryCacheEntry(
  env: AppEnv,
  input: {
    cacheKey: string;
    provider: AdDiscoveryProvider;
    routeContext: DiscoveryRouteContext;
    queryFingerprint: string;
    country: string;
    cursor: string | null;
    payload: SearchResponse;
    fetchedAt: string;
    expiresAt: string;
    browserMsUsed?: number | null;
  },
) {
  const timestamp = nowIso();

  try {
    await run(
      env,
      `
        INSERT INTO discovery_cache_entry (
          cache_key,
          provider,
          route_context,
          query_fingerprint,
          country,
          cursor,
          payload_json,
          fetched_at,
          expires_at,
          browser_ms_used,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          provider = excluded.provider,
          route_context = excluded.route_context,
          query_fingerprint = excluded.query_fingerprint,
          country = excluded.country,
          cursor = excluded.cursor,
          payload_json = excluded.payload_json,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at,
          browser_ms_used = excluded.browser_ms_used,
          updated_at = excluded.updated_at
      `,
      input.cacheKey,
      input.provider,
      input.routeContext,
      input.queryFingerprint,
      input.country,
      input.cursor,
      jsonValue(input.payload),
      input.fetchedAt,
      input.expiresAt,
      input.browserMsUsed ?? null,
      timestamp,
      timestamp,
    );
  } catch (error) {
    if (isMissingTableError(error, "discovery_cache_entry")) {
      return;
    }
    throw error;
  }
}

export async function getDiscoveryCacheEntry(env: AppEnv, cacheKey: string) {
  let row: DiscoveryCacheEntryRow | null;
  try {
    row = await one<DiscoveryCacheEntryRow>(
      env,
      `
        SELECT
          cache_key,
          provider,
          route_context,
          query_fingerprint,
          country,
          cursor,
          payload_json,
          fetched_at,
          expires_at,
          browser_ms_used,
          created_at,
          updated_at
        FROM discovery_cache_entry
        WHERE cache_key = ?
        LIMIT 1
      `,
      cacheKey,
    );
  } catch (error) {
    if (isMissingTableError(error, "discovery_cache_entry")) {
      return null;
    }
    throw error;
  }

  if (!row) {
    return null;
  }

  const payload = parseDiscoveryCachePayload(row.payload_json);
  if (!payload) {
    return null;
  }

  return {
    cacheKey: row.cache_key,
    provider: row.provider,
    routeContext: row.route_context,
    queryFingerprint: row.query_fingerprint,
    country: row.country,
    cursor: row.cursor,
    payload,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    browserMsUsed: row.browser_ms_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createDiscoveryFetchLog(
  env: AppEnv,
  input: {
    provider: AdDiscoveryProvider;
    routeContext: DiscoveryRouteContext;
    queryFingerprint: string;
    country: string;
    status: DiscoveryFetchStatus;
    cacheStatus: DiscoveryCacheStatus;
    failureClass: DiscoveryFailureClass | null;
    browserMsUsed?: number | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  try {
    await run(
      env,
      `
        INSERT INTO discovery_fetch_log (
          id,
          provider,
          route_context,
          query_fingerprint,
          country,
          status,
          cache_status,
          failure_class,
          browser_ms_used,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      createId(),
      input.provider,
      input.routeContext,
      input.queryFingerprint,
      input.country,
      input.status,
      input.cacheStatus,
      input.failureClass,
      input.browserMsUsed ?? null,
      jsonValue(input.metadata ?? null),
      nowIso(),
    );
  } catch (error) {
    if (isMissingTableError(error, "discovery_fetch_log")) {
      return;
    }
    throw error;
  }
}

export async function upsertDiscoveryProviderState(
  env: AppEnv,
  input: {
    provider: AdDiscoveryProvider;
    status: MetaIntegrationStatus["status"];
    failureClass: DiscoveryFailureClass | null;
    summary: string;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  try {
    await run(
      env,
      `
        INSERT INTO discovery_provider_state (
          provider,
          status,
          failure_class,
          summary,
          last_success_at,
          last_failure_at,
          metadata_json,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
          status = excluded.status,
          failure_class = excluded.failure_class,
          summary = excluded.summary,
          last_success_at = excluded.last_success_at,
          last_failure_at = excluded.last_failure_at,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `,
      input.provider,
      input.status,
      input.failureClass,
      input.summary,
      input.lastSuccessAt,
      input.lastFailureAt,
      jsonValue(input.metadata ?? null),
      nowIso(),
    );
  } catch (error) {
    if (isMissingTableError(error, "discovery_provider_state")) {
      return;
    }
    throw error;
  }
}

export async function getDiscoveryProviderState(env: AppEnv, provider: AdDiscoveryProvider) {
  let row: DiscoveryProviderStateRow | null;
  try {
    row = await one<DiscoveryProviderStateRow>(
      env,
      `
        SELECT
          provider,
          status,
          failure_class,
          summary,
          last_success_at,
          last_failure_at,
          metadata_json,
          updated_at
        FROM discovery_provider_state
        WHERE provider = ?
        LIMIT 1
      `,
      provider,
    );
  } catch (error) {
    if (isMissingTableError(error, "discovery_provider_state")) {
      return null;
    }
    throw error;
  }

  if (!row) {
    return null;
  }

  return {
    provider: row.provider,
    status: row.status,
    failureClass: row.failure_class,
    summary: row.summary,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    metadata: parseJson<Record<string, unknown> | null>(row.metadata_json, null),
    updatedAt: row.updated_at,
  };
}
