import { buildAnalysisFields } from "~/lib/analysis.server";
import { mapAdSourceToAnalysisSource } from "~/lib/ad-source-kind";
import type { AppEnv } from "~/lib/env.server";
import type { AdRecord, AnalysisFieldInput } from "~/lib/types";

interface AdLookupRow {
  id: string;
  raw_json: string;
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

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = await many<AdLookupRow>(
    env,
    `
      SELECT id, raw_json
      FROM ad
      WHERE id IN (${placeholders})
    `,
    ...uniqueIds,
  );
  const adsById = new Map<string, AdRecord>();

  for (const row of rows) {
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
      ?? storedAd?.creativeTextCaptureMethod
      ?? storedAd?.creativeTextMetadata,
    );

    if (!storedAd || (!hasStoredCreative && !storedTranslatedField)) {
      return ad;
    }

    return {
      ...ad,
      creativeText: ad.creativeText ?? storedAd.creativeText ?? null,
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
    ad.metaAdId,
    ad.advertiser,
    ad.body,
    ad.bodySecondary ?? null,
    ad.previewHeadline,
    ad.previewSubhead,
    ad.hook,
    ad.offer,
    ad.cta,
    ad.format,
    ad.languageLabel,
    ad.destinationType,
    ad.landingPageUrl,
    ad.adSnapshotUrl,
    jsonValue(ad.countries),
    jsonValue(ad.platforms),
    ad.firstSeenAt,
    ad.lastSeenAt,
    ad.active ? 1 : 0,
    ad.source,
    ad.researchSummary,
    ad.creativeText ?? null,
    ad.creativeTextCaptureMethod ?? null,
    jsonValue(ad.creativeTextMetadata ?? null),
    jsonValue(ad),
    timestamp,
    timestamp,
  );

  await replaceAnalysisFields(
    env,
    "ad",
    ad.metaAdId,
    ad.analysisFields.length > 0
      ? ad.analysisFields
      : buildAnalysisFields(ad, mapAdSourceToAnalysisSource(ad.source)),
  );
}

export async function replaceAnalysisFields(
  env: AppEnv,
  scopeType: "ad" | "observation" | "landing_page",
  scopeId: string,
  fields: AnalysisFieldInput[],
) {
  await run(
    env,
    "DELETE FROM analysis_field WHERE scope_type = ? AND scope_id = ?",
    scopeType,
    scopeId,
  );

  for (const field of fields) {
    const timestamp = nowIso();
    await run(
      env,
      `
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
      `,
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
    );
  }
}
