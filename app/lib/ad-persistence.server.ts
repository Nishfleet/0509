import { buildAnalysisFields } from "~/lib/analysis.server";
import { mapAdSourceToAnalysisSource } from "~/lib/ad-source-kind";
import { chunkForBoundParams } from "~/lib/d1-chunk.server";
import type { AppEnv } from "~/lib/env.server";
import type { AdRecord, AnalysisFieldInput } from "~/lib/types";

interface AdLookupRow {
  id: string;
  raw_json: string;
}

interface AdSeenWindowRow {
  first_seen_at: string | null;
  last_seen_at: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomUUID();
}

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

function parseSeenTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

// Seen-window ratchet: first_seen_at only ever moves earlier and last_seen_at
// only ever moves later. A later scan that could not read a date (null) must
// never clobber a real one already on record.
function earliestSeenAt(incoming: string | null, stored: string | null): string | null {
  const incomingTime = parseSeenTimestamp(incoming);
  const storedTime = parseSeenTimestamp(stored);

  if (incomingTime === null) {
    return storedTime === null ? null : stored;
  }
  if (storedTime === null) {
    return incoming;
  }

  return incomingTime <= storedTime ? incoming : stored;
}

function latestSeenAt(incoming: string | null, stored: string | null): string | null {
  const incomingTime = parseSeenTimestamp(incoming);
  const storedTime = parseSeenTimestamp(stored);

  if (incomingTime === null) {
    return storedTime === null ? null : stored;
  }
  if (storedTime === null) {
    return incoming;
  }

  return incomingTime >= storedTime ? incoming : stored;
}

function findTranslatedAnalysisField(fields: AnalysisFieldInput[]) {
  return fields.find((field) => field.fieldKey === "translated_text" && field.fieldValue.trim()) ?? null;
}

function mergePersistedTranslatedField(
  fields: AnalysisFieldInput[],
  storedFields: AnalysisFieldInput[],
) {
  const translatedField = findTranslatedAnalysisField(fields) ?? findTranslatedAnalysisField(storedFields);

  if (!translatedField) {
    return fields;
  }

  const remaining = fields.filter((field) => field.fieldKey !== "translated_text");

  return [...remaining, translatedField];
}

export async function listAdsByIds(env: AppEnv, adIds: string[]) {
  const uniqueIds = [...new Set(adIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return [];
  }

  // Chunked lookups keep each statement under D1's 100-bound-parameter cap;
  // a single large scan can reference more than 100 unique ads.
  const chunkedRows = await Promise.all(
    chunkForBoundParams(uniqueIds).map((chunk) => {
      const placeholders = chunk.map(() => "?").join(", ");
      return many<AdLookupRow>(
        env,
        `
          SELECT id, raw_json
          FROM ad
          WHERE id IN (${placeholders})
        `,
        ...chunk,
      );
    }),
  );
  const adsById = new Map<string, AdRecord>();

  for (const row of chunkedRows.flat()) {
    const ad = parseJson<AdRecord | null>(row.raw_json, null);
    if (ad) {
      adsById.set(row.id, ad);
    }
  }

  return uniqueIds
    .map((adId) => adsById.get(adId))
    .filter((ad): ad is AdRecord => Boolean(ad));
}

export async function hydrateAdsWithPersistedCreatives(env: AppEnv, ads: AdRecord[]) {
  if (ads.length === 0) {
    return [];
  }

  const storedAds = await listAdsByIds(
    env,
    ads.map((ad) => ad.metaAdId),
  );
  const storedAdsById = new Map(storedAds.map((ad) => [ad.metaAdId, ad]));

  return ads.map((ad) => {
    const storedAd = storedAdsById.get(ad.metaAdId);
    const storedTranslatedField = storedAd
      ? findTranslatedAnalysisField(storedAd.analysisFields)
      : null;
    const hasStoredCreative = Boolean(
      storedAd?.creativeText
      ?? storedAd?.creativeImageUrl
      ?? storedAd?.creativeTextCaptureMethod
      ?? storedAd?.creativeTextMetadata,
    );

    if (!storedAd || (!hasStoredCreative && !storedTranslatedField)) {
      return ad;
    }

    return {
      ...ad,
      creativeText: ad.creativeText ?? storedAd.creativeText ?? null,
      creativeImageUrl: ad.creativeImageUrl ?? storedAd.creativeImageUrl ?? null,
      creativeTextCaptureMethod:
        ad.creativeTextCaptureMethod ?? storedAd.creativeTextCaptureMethod ?? null,
      creativeTextMetadata:
        ad.creativeTextMetadata ?? storedAd.creativeTextMetadata ?? null,
      analysisFields: mergePersistedTranslatedField(ad.analysisFields, storedAd.analysisFields),
    };
  });
}

export async function upsertAd(env: AppEnv, ad: AdRecord) {
  const timestamp = nowIso();
  // Hydration reads ONLY raw_json, so ratcheted dates must land in the
  // serialized AdRecord too — writing the SQL columns alone would let stale
  // raw_json dates resurface on every read.
  const storedWindows = await many<AdSeenWindowRow>(
    env,
    "SELECT first_seen_at, last_seen_at FROM ad WHERE id = ?",
    ad.metaAdId,
  );
  const storedWindow = storedWindows[0] ?? null;
  const persistedAd: AdRecord = {
    ...ad,
    firstSeenAt: earliestSeenAt(ad.firstSeenAt, storedWindow?.first_seen_at ?? null),
    lastSeenAt: latestSeenAt(ad.lastSeenAt, storedWindow?.last_seen_at ?? null),
  };
  await run(
    env,
    `
      INSERT INTO ad (
        id,
        advertiser,
        body,
        body_secondary,
        preview_headline,
        preview_subhead,
        hook,
        offer_text,
        cta,
        creative_format,
        language_label,
        destination_type,
        landing_page_url,
        ad_snapshot_url,
        countries_json,
        platforms_json,
        first_seen_at,
        last_seen_at,
        is_active,
        source,
        research_summary,
        creative_text,
        creative_text_capture_method,
        creative_text_metadata_json,
        raw_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id)
      DO UPDATE SET advertiser = excluded.advertiser,
                    body = excluded.body,
                    body_secondary = excluded.body_secondary,
                    preview_headline = excluded.preview_headline,
                    preview_subhead = excluded.preview_subhead,
                    hook = excluded.hook,
                    offer_text = excluded.offer_text,
                    cta = excluded.cta,
                    creative_format = excluded.creative_format,
                    language_label = excluded.language_label,
                    destination_type = excluded.destination_type,
                    landing_page_url = excluded.landing_page_url,
                    ad_snapshot_url = excluded.ad_snapshot_url,
                    countries_json = excluded.countries_json,
                    platforms_json = excluded.platforms_json,
                    first_seen_at = excluded.first_seen_at,
                    last_seen_at = excluded.last_seen_at,
                    is_active = excluded.is_active,
                    source = excluded.source,
                    research_summary = excluded.research_summary,
                    creative_text = excluded.creative_text,
                    creative_text_capture_method = excluded.creative_text_capture_method,
                    creative_text_metadata_json = excluded.creative_text_metadata_json,
                    raw_json = excluded.raw_json,
                    updated_at = excluded.updated_at
    `,
    persistedAd.metaAdId,
    persistedAd.advertiser,
    persistedAd.body,
    persistedAd.bodySecondary ?? null,
    persistedAd.previewHeadline,
    persistedAd.previewSubhead,
    persistedAd.hook,
    persistedAd.offer,
    persistedAd.cta,
    persistedAd.format,
    persistedAd.languageLabel,
    persistedAd.destinationType,
    persistedAd.landingPageUrl,
    persistedAd.adSnapshotUrl,
    jsonValue(persistedAd.countries),
    jsonValue(persistedAd.platforms),
    persistedAd.firstSeenAt,
    persistedAd.lastSeenAt,
    persistedAd.active ? 1 : 0,
    persistedAd.source,
    persistedAd.researchSummary,
    persistedAd.creativeText ?? null,
    persistedAd.creativeTextCaptureMethod ?? null,
    jsonValue(persistedAd.creativeTextMetadata ?? null),
    jsonValue(persistedAd),
    timestamp,
    timestamp,
  );

  await replaceAnalysisFields(
    env,
    "ad",
    persistedAd.metaAdId,
    persistedAd.analysisFields.length > 0
      ? persistedAd.analysisFields
      : buildAnalysisFields(persistedAd, mapAdSourceToAnalysisSource(persistedAd.source)),
  );
}

export async function replaceAnalysisFields(
  env: AppEnv,
  scopeType: "ad" | "observation" | "landing_page",
  scopeId: string,
  fields: AnalysisFieldInput[],
) {
  const db = ensureDb(env);
  const timestamp = nowIso();
  const statements = [
    db.prepare("DELETE FROM analysis_field WHERE scope_type = ? AND scope_id = ?").bind(scopeType, scopeId),
  ];

  for (const field of fields) {
    statements.push(
      db.prepare(`
        INSERT INTO analysis_field (
          id,
          scope_type,
          scope_id,
          field_key,
          field_value,
          provenance_source,
          extractor_version,
          confidence,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        createId(),
        scopeType,
        scopeId,
        field.fieldKey,
        field.fieldValue,
        field.provenanceSource,
        field.extractorVersion,
        field.confidence ?? null,
        jsonValue(field.metadata ?? null),
        timestamp,
        timestamp,
      ),
    );
  }

  await db.batch(statements);
}
