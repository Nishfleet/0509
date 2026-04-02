import { buildLandingPageAnalysisFields } from "~/lib/analysis.server";
import {
  hydrateAdsWithPersistedCreatives,
  listAdsByIds,
  replaceAnalysisFields,
  upsertAd,
} from "~/lib/ad-persistence.server";
import type { AppEnv } from "~/lib/env.server";
import { fingerprintSavedQuery, normalizeSavedQuery } from "~/lib/normalize";
import type {
  AdRecord,
  AnalysisFieldInput,
  AppSession,
  CollectionItemRecord,
  CollectionRecord,
  DigestDeliveryRecord,
  DigestItemRecord,
  DigestRecord,
  MetaIntegrationStatus,
  NormalizedSavedQuery,
  PricingRegion,
  SavedQueryRecord,
  ShareLinkRecord,
  ShareResourceType,
  WatchEventRecord,
  WatchEventType,
  WatchTargetType,
  WatchlistRecord,
  WatchlistRunRecord,
} from "~/lib/types";

type JsonRecord = Record<string, unknown>;

interface SavedQueryRow {
  id: string;
  user_id: string;
  name: string;
  mode: SavedQueryRecord["mode"];
  query_text: string;
  normalized_query_json: string;
  fingerprint: string;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionItemRow {
  id: string;
  collection_id: string;
  ad_id: string;
  note: string | null;
  ad_snapshot_json: string;
  created_at: string;
  updated_at: string;
}

interface WatchlistRow {
  id: string;
  user_id: string;
  name: string;
  target_type: WatchTargetType;
  target_id: string;
  target_fingerprint: string;
  target_label: string;
  is_active: number;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WatchlistRunRow {
  id: string;
  watchlist_id: string;
  trigger_type: WatchlistRunRecord["triggerType"];
  status: WatchlistRunRecord["status"];
  page_budget: number;
  pages_scanned: number;
  baseline_from_run_id: string | null;
  summary_json: string;
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface WatchEventRow {
  id: string;
  watchlist_id: string;
  run_id: string;
  event_type: WatchEventType;
  ad_id: string | null;
  baseline_from_run_id: string | null;
  title: string;
  summary: string;
  metadata_json: string;
  created_at: string;
}

interface ObservationRow {
  id: string;
  ad_id: string;
  watchlist_run_id: string;
  landing_page_snapshot_id: string | null;
  landing_page_url: string | null;
  normalized_headline_hash: string | null;
  raw_headline: string | null;
  seen_at: string;
  is_active: number;
  metadata_json: string;
}

interface DigestRunRow {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  created_at: string;
}

interface DigestItemRow {
  id: string;
  digest_run_id: string;
  watchlist_id: string;
  watchlist_name: string;
  event_type: WatchEventType;
  title: string;
  summary: string;
  created_at: string;
}

interface DigestDeliveryRow {
  id: string;
  digest_run_id: string;
  provider: "resend";
  status: DigestDeliveryRecord["status"];
  recipient_email: string;
  external_message_id: string | null;
  error_message: string | null;
  delivered_at: string | null;
}

interface ShareLinkRow {
  id: string;
  token: string;
  user_id: string;
  resource_type: ShareResourceType;
  resource_id: string;
  is_snapshot: number;
  snapshot_payload_json: string | null;
  created_at: string;
}

interface MetaLogRow {
  status: MetaIntegrationStatus["status"];
  summary: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createId() {
  return crypto.randomUUID();
}

export {
  hydrateAdsWithPersistedCreatives,
  listAdsByIds,
  replaceAnalysisFields,
  upsertAd,
} from "~/lib/ad-persistence.server";

function ensureDb(env: AppEnv) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  return env.DB;
}

async function many<T>(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const db = ensureDb(env);
  const result = await db.prepare(sql).bind(...bindings).all<T>();
  return result.results ?? [];
}

async function one<T>(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const rows = await many<T>(env, sql, ...bindings);
  return rows[0] ?? null;
}

async function run(env: AppEnv, sql: string, ...bindings: unknown[]) {
  const db = ensureDb(env);
  await db.prepare(sql).bind(...bindings).run();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function jsonValue(value: unknown) {
  return JSON.stringify(value ?? null);
}

function toSavedQueryRecord(row: SavedQueryRow): SavedQueryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    mode: row.mode,
    queryText: row.query_text,
    normalizedQuery: parseJson<NormalizedSavedQuery>(row.normalized_query_json, normalizeSavedQuery("advertiser", {})),
    fingerprint: row.fingerprint,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCollectionRecord(row: CollectionRow): CollectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWatchlistRecord(row: WatchlistRow): WatchlistRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    targetType: row.target_type,
    targetId: row.target_id,
    targetFingerprint: row.target_fingerprint,
    targetLabel: row.target_label,
    isActive: row.is_active === 1,
    lastScannedAt: row.last_scanned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWatchlistRunRecord(row: WatchlistRunRow): WatchlistRunRecord {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    triggerType: row.trigger_type,
    status: row.status,
    pageBudget: row.page_budget,
    pagesScanned: row.pages_scanned,
    baselineFromRunId: row.baseline_from_run_id,
    summary: parseJson<JsonRecord>(row.summary_json, {}),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

function toWatchEventRecord(row: WatchEventRow): WatchEventRecord {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    runId: row.run_id,
    eventType: row.event_type,
    adId: row.ad_id,
    baselineFromRunId: row.baseline_from_run_id,
    title: row.title,
    summary: row.summary,
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function toDigestItemRecord(row: DigestItemRow): DigestItemRecord {
  return {
    id: row.id,
    digestRunId: row.digest_run_id,
    watchlistId: row.watchlist_id,
    watchlistName: row.watchlist_name,
    eventType: row.event_type,
    title: row.title,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function toDigestDeliveryRecord(row: DigestDeliveryRow): DigestDeliveryRecord {
  return {
    id: row.id,
    digestRunId: row.digest_run_id,
    provider: row.provider,
    status: row.status,
    recipientEmail: row.recipient_email,
    externalMessageId: row.external_message_id,
    errorMessage: row.error_message,
    deliveredAt: row.delivered_at,
  };
}

export async function getPricingRegionPreference(env: AppEnv, userId: string) {
  const row = await one<{ region: PricingRegion }>(
    env,
    "SELECT region FROM pricing_region_preference WHERE user_id = ?",
    userId,
  );
  return row?.region ?? null;
}

export async function upsertPricingRegionPreference(
  env: AppEnv,
  userId: string,
  region: PricingRegion,
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO pricing_region_preference (id, user_id, region, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET region = excluded.region, updated_at = excluded.updated_at
    `,
    createId(),
    userId,
    region,
    timestamp,
    timestamp,
  );
}

export async function listSavedQueries(env: AppEnv, userId: string) {
  const rows = await many<SavedQueryRow>(
    env,
    `
      SELECT *
      FROM saved_query
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `,
    userId,
  );

  return rows.map(toSavedQueryRecord);
}

export async function getSavedQuery(env: AppEnv, savedQueryId: string, userId?: string) {
  const row = await one<SavedQueryRow>(
    env,
    `
      SELECT *
      FROM saved_query
      WHERE id = ? ${userId ? "AND user_id = ?" : ""}
    `,
    ...(userId ? [savedQueryId, userId] : [savedQueryId]),
  );

  return row ? toSavedQueryRecord(row) : null;
}

export async function createSavedQuery(
  env: AppEnv,
  userId: string,
  input: {
    name: string;
    mode: SavedQueryRecord["mode"];
    filters: Partial<NormalizedSavedQuery["filters"]>;
  },
) {
  const normalizedQuery = normalizeSavedQuery(input.mode, input.filters);
  const timestamp = nowIso();
  const id = createId();

  await run(
    env,
    `
      INSERT INTO saved_query (
        id,
        user_id,
        name,
        mode,
        query_text,
        normalized_query_json,
        fingerprint,
        run_count,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `,
    id,
    userId,
    input.name.trim(),
    normalizedQuery.mode,
    normalizedQuery.filters.query,
    jsonValue(normalizedQuery),
    fingerprintSavedQuery(normalizedQuery),
    timestamp,
    timestamp,
  );

  return getSavedQuery(env, id, userId);
}

export async function touchSavedQueryRun(env: AppEnv, savedQueryId: string) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE saved_query
      SET run_count = run_count + 1,
          last_run_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
    timestamp,
    timestamp,
    savedQueryId,
  );
}

export async function listCollections(env: AppEnv, userId: string) {
  const rows = await many<CollectionRow>(
    env,
    `
      SELECT *
      FROM collection
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `,
    userId,
  );
  return rows.map(toCollectionRecord);
}

export async function getCollection(env: AppEnv, collectionId: string, userId?: string) {
  const row = await one<CollectionRow>(
    env,
    `
      SELECT *
      FROM collection
      WHERE id = ? ${userId ? "AND user_id = ?" : ""}
    `,
    ...(userId ? [collectionId, userId] : [collectionId]),
  );

  return row ? toCollectionRecord(row) : null;
}

export async function createCollection(
  env: AppEnv,
  userId: string,
  input: { name: string; description?: string | null },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO collection (id, user_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    id,
    userId,
    input.name.trim(),
    input.description?.trim() ?? null,
    timestamp,
    timestamp,
  );

  const row = await one<CollectionRow>(env, "SELECT * FROM collection WHERE id = ?", id);
  return row ? toCollectionRecord(row) : null;
}

export async function listCollectionItems(env: AppEnv, collectionId: string) {
  const rows = await many<CollectionItemRow>(
    env,
    `
      SELECT *
      FROM collection_item
      WHERE collection_id = ?
      ORDER BY created_at DESC
    `,
    collectionId,
  );

  const itemIds = rows.map((row: CollectionItemRow) => row.id);
  const tagsByItemId = new Map<string, string[]>();

  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => "?").join(", ");
    const tags = await many<{ collection_item_id: string; label: string }>(
      env,
      `
        SELECT collection_item_tag.collection_item_id, tag.label
        FROM collection_item_tag
        INNER JOIN tag ON tag.id = collection_item_tag.tag_id
        WHERE collection_item_tag.collection_item_id IN (${placeholders})
        ORDER BY tag.label ASC
      `,
      ...itemIds,
    );

    for (const row of tags) {
      const next = tagsByItemId.get(row.collection_item_id) ?? [];
      next.push(row.label);
      tagsByItemId.set(row.collection_item_id, next);
    }
  }

  return rows.map<CollectionItemRecord>((row: CollectionItemRow) => ({
    id: row.id,
    collectionId: row.collection_id,
    adId: row.ad_id,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ad: parseJson<AdRecord>(row.ad_snapshot_json, {} as AdRecord),
    tags: tagsByItemId.get(row.id) ?? [],
  }));
}

export async function updateCollectionItem(
  env: AppEnv,
  userId: string,
  itemId: string,
  input: { note: string | null; tags: string[] },
) {
  const owner = await one<{ id: string }>(
    env,
    `
      SELECT collection_item.id
      FROM collection_item
      INNER JOIN collection ON collection.id = collection_item.collection_id
      WHERE collection_item.id = ? AND collection.user_id = ?
    `,
    itemId,
    userId,
  );

  if (!owner) {
    throw new Error("Collection item not found.");
  }

  const timestamp = nowIso();
  await run(
    env,
    "UPDATE collection_item SET note = ?, updated_at = ? WHERE id = ?",
    input.note?.trim() || null,
    timestamp,
    itemId,
  );

  await run(env, "DELETE FROM collection_item_tag WHERE collection_item_id = ?", itemId);
  const tagIds = await ensureTags(env, userId, input.tags);

  for (const tagId of tagIds) {
    await run(
      env,
      `
        INSERT INTO collection_item_tag (collection_item_id, tag_id)
        VALUES (?, ?)
      `,
      itemId,
      tagId,
    );
  }
}

export async function addAdToCollection(
  env: AppEnv,
  userId: string,
  collectionId: string,
  ad: AdRecord,
  note: string | null,
  tags: string[],
) {
  const collection = await one<{ id: string }>(
    env,
    "SELECT id FROM collection WHERE id = ? AND user_id = ?",
    collectionId,
    userId,
  );

  if (!collection) {
    throw new Error("Collection not found.");
  }

  await upsertAd(env, ad);

  const itemId = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO collection_item (
        id,
        collection_id,
        ad_id,
        note,
        ad_snapshot_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection_id, ad_id)
      DO UPDATE SET note = excluded.note,
                    ad_snapshot_json = excluded.ad_snapshot_json,
                    updated_at = excluded.updated_at
    `,
    itemId,
    collectionId,
    ad.metaAdId,
    note?.trim() || null,
    jsonValue(ad),
    timestamp,
    timestamp,
  );

  const row = await one<{ id: string }>(
    env,
    "SELECT id FROM collection_item WHERE collection_id = ? AND ad_id = ?",
    collectionId,
    ad.metaAdId,
  );

  if (row) {
    await updateCollectionItem(env, userId, row.id, { note, tags });
  }
}

async function ensureTags(env: AppEnv, userId: string, labels: string[]) {
  const uniqueLabels = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  const ids: string[] = [];

  for (const label of uniqueLabels) {
    const existing = await one<{ id: string }>(
      env,
      "SELECT id FROM tag WHERE user_id = ? AND label = ?",
      userId,
      label,
    );

    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const id = createId();
    const timestamp = nowIso();
    await run(
      env,
      `
        INSERT INTO tag (id, user_id, label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      id,
      userId,
      label,
      timestamp,
      timestamp,
    );
    ids.push(id);
  }

  return ids;
}

export async function listWatchlists(env: AppEnv, userId: string) {
  const rows = await many<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `,
    userId,
  );
  return rows.map(toWatchlistRecord);
}

export async function listActiveWatchlists(env: AppEnv) {
  const rows = await many<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE is_active = 1
      ORDER BY updated_at ASC
    `,
  );
  return rows.map(toWatchlistRecord);
}

export async function getWatchlist(env: AppEnv, watchlistId: string, userId?: string) {
  const row = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE id = ? ${userId ? "AND user_id = ?" : ""}
    `,
    ...(userId ? [watchlistId, userId] : [watchlistId]),
  );

  return row ? toWatchlistRecord(row) : null;
}

export async function createWatchlist(
  env: AppEnv,
  userId: string,
  input: {
    name: string;
    targetType: WatchTargetType;
    targetId: string;
    targetFingerprint: string;
    targetLabel: string;
  },
) {
  const existing = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND target_fingerprint = ?
        AND is_active = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    userId,
    input.targetFingerprint,
  );

  if (existing) {
    return toWatchlistRecord(existing);
  }

  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT OR IGNORE INTO watchlist (
        id,
        user_id,
        name,
        target_type,
        target_id,
        target_fingerprint,
        target_label,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `,
    id,
    userId,
    input.name.trim(),
    input.targetType,
    input.targetId,
    input.targetFingerprint,
    input.targetLabel,
    timestamp,
    timestamp,
  );

  const created = await getWatchlist(env, id, userId);
  if (created) {
    return created;
  }

  const concurrent = await one<WatchlistRow>(
    env,
    `
      SELECT *
      FROM watchlist
      WHERE user_id = ?
        AND target_fingerprint = ?
        AND is_active = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    userId,
    input.targetFingerprint,
  );

  return concurrent ? toWatchlistRecord(concurrent) : null;
}

export async function createWatchlistRun(
  env: AppEnv,
  watchlistId: string,
  triggerType: WatchlistRunRecord["triggerType"],
  baselineFromRunId: string | null,
  pageBudget: number,
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO watchlist_run (
        id,
        watchlist_id,
        trigger_type,
        status,
        page_budget,
        pages_scanned,
        baseline_from_run_id,
        summary_json,
        started_at,
        finished_at,
        error_code,
        error_message,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'running', ?, 0, ?, '{}', ?, NULL, NULL, NULL, ?, ?)
    `,
    id,
    watchlistId,
    triggerType,
    pageBudget,
    baselineFromRunId,
    timestamp,
    timestamp,
    timestamp,
  );

  return id;
}

export async function finishWatchlistRun(
  env: AppEnv,
  runId: string,
  input: {
    status: WatchlistRunRecord["status"];
    pagesScanned: number;
    summary: JsonRecord;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE watchlist_run
      SET status = ?,
          pages_scanned = ?,
          summary_json = ?,
          finished_at = ?,
          error_code = ?,
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `,
    input.status,
    input.pagesScanned,
    jsonValue(input.summary),
    timestamp,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    timestamp,
    runId,
  );
}

export async function getRecentSuccessfulRuns(
  env: AppEnv,
  watchlistId: string,
  limit = 3,
) {
  const rows = await many<WatchlistRunRow>(
    env,
    `
      SELECT *
      FROM watchlist_run
      WHERE watchlist_id = ? AND status = 'succeeded'
      ORDER BY started_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );
  return rows.map(toWatchlistRunRecord);
}

export async function listWatchlistRuns(
  env: AppEnv,
  watchlistId: string,
  limit = 12,
) {
  const rows = await many<WatchlistRunRow>(
    env,
    `
      SELECT *
      FROM watchlist_run
      WHERE watchlist_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toWatchlistRunRecord);
}

export async function touchWatchlistScanned(env: AppEnv, watchlistId: string) {
  const timestamp = nowIso();
  await run(
    env,
    `
      UPDATE watchlist
      SET last_scanned_at = ?, updated_at = ?
      WHERE id = ?
    `,
    timestamp,
    timestamp,
    watchlistId,
  );
}

export async function listWatchEvents(
  env: AppEnv,
  watchlistId: string,
  limit = 40,
) {
  const rows = await many<WatchEventRow>(
    env,
    `
      SELECT *
      FROM watch_event
      WHERE watchlist_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    watchlistId,
    limit,
  );

  return rows.map(toWatchEventRecord);
}

export async function listWatchEventsBetween(
  env: AppEnv,
  watchlistId: string,
  periodStart: string,
  periodEnd: string,
) {
  const rows = await many<WatchEventRow>(
    env,
    `
      SELECT *
      FROM watch_event
      WHERE watchlist_id = ?
        AND created_at >= ?
        AND created_at <= ?
      ORDER BY created_at DESC
    `,
    watchlistId,
    periodStart,
    periodEnd,
  );

  return rows.map(toWatchEventRecord);
}

export async function createWatchEvent(
  env: AppEnv,
  input: {
    watchlistId: string;
    runId: string;
    eventType: WatchEventType;
    adId: string | null;
    baselineFromRunId: string | null;
    title: string;
    summary: string;
    metadata: JsonRecord;
  },
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO watch_event (
        id,
        watchlist_id,
        run_id,
        event_type,
        ad_id,
        baseline_from_run_id,
        title,
        summary,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    createId(),
    input.watchlistId,
    input.runId,
    input.eventType,
    input.adId,
    input.baselineFromRunId,
    input.title,
    input.summary,
    jsonValue(input.metadata),
    timestamp,
  );
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

export async function createAdObservation(
  env: AppEnv,
  input: {
    adId: string;
    watchlistRunId: string;
    landingPageSnapshotId: string | null;
    landingPageUrl: string | null;
    seenAt: string;
    isActive: boolean;
    metadata?: JsonRecord;
  },
) {
  const id = createId();
  await run(
    env,
    `
      INSERT INTO ad_observation (
        id,
        ad_id,
        watchlist_run_id,
        landing_page_snapshot_id,
        seen_at,
        is_active,
        landing_page_url,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    input.adId,
    input.watchlistRunId,
    input.landingPageSnapshotId,
    input.seenAt,
    input.isActive ? 1 : 0,
    input.landingPageUrl,
    jsonValue(input.metadata ?? {}),
    nowIso(),
  );

  return id;
}

export async function listObservationsForRun(env: AppEnv, runId: string) {
  return many<ObservationRow>(
    env,
    `
      SELECT
        ad_observation.id,
        ad_observation.ad_id,
        ad_observation.watchlist_run_id,
        ad_observation.landing_page_snapshot_id,
        ad_observation.landing_page_url,
        ad_observation.seen_at,
        ad_observation.is_active,
        ad_observation.metadata_json,
        landing_page_snapshot.normalized_headline_hash,
        landing_page_snapshot.raw_headline
      FROM ad_observation
      LEFT JOIN landing_page_snapshot
        ON landing_page_snapshot.id = ad_observation.landing_page_snapshot_id
      WHERE ad_observation.watchlist_run_id = ?
    `,
    runId,
  );
}

export async function createDigestRun(
  env: AppEnv,
  userId: string,
  periodStart: string,
  periodEnd: string,
  summary: JsonRecord,
) {
  const id = createId();
  await run(
    env,
    `
      INSERT OR IGNORE INTO digest_run (
        id,
        user_id,
        period_start,
        period_end,
        summary_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    id,
    userId,
    periodStart,
    periodEnd,
    jsonValue(summary),
    nowIso(),
  );

  const row = await one<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
        AND period_start = ?
        AND period_end = ?
      LIMIT 1
    `,
    userId,
    periodStart,
    periodEnd,
  );

  return row?.id ?? id;
}

export async function clearDigestItems(env: AppEnv, digestRunId: string) {
  await run(env, "DELETE FROM digest_item WHERE digest_run_id = ?", digestRunId);
}

export async function addDigestItem(
  env: AppEnv,
  digestRunId: string,
  input: {
    watchlistId: string;
    watchlistName: string;
    eventType: WatchEventType;
    title: string;
    summary: string;
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      INSERT INTO digest_item (
        id,
        digest_run_id,
        watchlist_id,
        watchlist_name,
        event_type,
        title,
        summary,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    createId(),
    digestRunId,
    input.watchlistId,
    input.watchlistName,
    input.eventType,
    input.title,
    input.summary,
    jsonValue(input.metadata ?? {}),
    nowIso(),
  );
}

export async function upsertDigestDelivery(
  env: AppEnv,
  digestRunId: string,
  input: Omit<DigestDeliveryRecord, "id" | "digestRunId">,
) {
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO digest_delivery (
        id,
        digest_run_id,
        provider,
        status,
        recipient_email,
        external_message_id,
        error_message,
        delivered_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(digest_run_id)
      DO UPDATE SET status = excluded.status,
                    recipient_email = excluded.recipient_email,
                    external_message_id = excluded.external_message_id,
                    error_message = excluded.error_message,
                    delivered_at = excluded.delivered_at,
                    updated_at = excluded.updated_at
    `,
    createId(),
    digestRunId,
    input.provider,
    input.status,
    input.recipientEmail,
    input.externalMessageId,
    input.errorMessage,
    input.deliveredAt,
    timestamp,
    timestamp,
  );
}

export async function listDigests(env: AppEnv, userId: string) {
  const runs = await many<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
      ORDER BY period_end DESC
    `,
    userId,
  );

  const digests: DigestRecord[] = [];
  for (const run of runs) {
    const items = await many<DigestItemRow>(
      env,
      "SELECT * FROM digest_item WHERE digest_run_id = ? ORDER BY created_at ASC",
      run.id,
    );
    const delivery = await one<DigestDeliveryRow>(
      env,
      "SELECT * FROM digest_delivery WHERE digest_run_id = ?",
      run.id,
    );
    digests.push({
      id: run.id,
      userId: run.user_id,
      periodStart: run.period_start,
      periodEnd: run.period_end,
      createdAt: run.created_at,
      items: items.map(toDigestItemRecord),
      delivery: delivery ? toDigestDeliveryRecord(delivery) : null,
    });
  }

  return digests;
}

export async function getDigest(env: AppEnv, digestRunId: string) {
  const run = await one<DigestRunRow>(env, "SELECT * FROM digest_run WHERE id = ?", digestRunId);
  if (!run) {
    return null;
  }
  const [items, delivery] = await Promise.all([
    many<DigestItemRow>(
      env,
      "SELECT * FROM digest_item WHERE digest_run_id = ? ORDER BY created_at ASC",
      digestRunId,
    ),
    one<DigestDeliveryRow>(env, "SELECT * FROM digest_delivery WHERE digest_run_id = ?", digestRunId),
  ]);

  return {
    id: run.id,
    userId: run.user_id,
    periodStart: run.period_start,
    periodEnd: run.period_end,
    createdAt: run.created_at,
    items: items.map(toDigestItemRecord),
    delivery: delivery ? toDigestDeliveryRecord(delivery) : null,
  } satisfies DigestRecord;
}

export async function getDigestByPeriod(
  env: AppEnv,
  userId: string,
  periodStart: string,
  periodEnd: string,
) {
  const row = await one<DigestRunRow>(
    env,
    `
      SELECT *
      FROM digest_run
      WHERE user_id = ?
        AND period_start = ?
        AND period_end = ?
      LIMIT 1
    `,
    userId,
    periodStart,
    periodEnd,
  );

  if (!row) {
    return null;
  }

  return getDigest(env, row.id);
}

export async function createShareLink(
  env: AppEnv,
  session: AppSession,
  input: {
    resourceType: ShareResourceType;
    resourceId: string;
    isSnapshot: boolean;
    snapshotPayload?: JsonRecord | null;
  },
) {
  const id = createId();
  const token = crypto.randomUUID().replaceAll("-", "");
  await run(
    env,
    `
      INSERT INTO share_link (
        id,
        token,
        user_id,
        resource_type,
        resource_id,
        is_snapshot,
        snapshot_payload_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    token,
    session.user.id,
    input.resourceType,
    input.resourceId,
    input.isSnapshot ? 1 : 0,
    input.snapshotPayload ? jsonValue(input.snapshotPayload) : null,
    nowIso(),
  );

  return { id, token };
}

export async function getShareLink(env: AppEnv, token: string) {
  const row = await one<ShareLinkRow>(
    env,
    "SELECT * FROM share_link WHERE token = ?",
    token,
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    token: row.token,
    userId: row.user_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    isSnapshot: row.is_snapshot === 1,
    snapshotPayload: parseJson<JsonRecord | null>(row.snapshot_payload_json, null),
    createdAt: row.created_at,
  } satisfies ShareLinkRecord;
}

export async function logMetaIntegrationStatus(
  env: AppEnv,
  input: {
    status: MetaIntegrationStatus["status"];
    summary: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonRecord;
  },
) {
  await run(
    env,
    `
      INSERT INTO meta_integration_log (
        id,
        status,
        summary,
        error_code,
        error_message,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    createId(),
    input.status,
    input.summary,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    jsonValue(input.metadata ?? null),
    nowIso(),
  );
}

export async function getMetaIntegrationStatus(env: AppEnv) {
  const row = await one<MetaLogRow>(
    env,
    `
      SELECT status, summary, error_code, error_message, created_at
      FROM meta_integration_log
      ORDER BY created_at DESC
      LIMIT 1
    `,
  );

  return {
    status: row?.status ?? (env.META_AD_LIBRARY_TOKEN ? "healthy" : "demo"),
    summary:
      row?.summary ??
      (env.META_AD_LIBRARY_TOKEN
        ? "Meta Ad Library secret detected and ready for live searches."
        : "No Meta Ad Library token is configured. The app is running in explicit demo mode."),
    lastCheckedAt: row?.created_at ?? null,
    lastErrorCode: row?.error_code ?? null,
    lastErrorMessage: row?.error_message ?? null,
  } satisfies MetaIntegrationStatus;
}
