import { buildAnalysisFields } from "~/lib/analysis.server";
import { mapAdSourceToAnalysisSource } from "~/lib/ad-source-kind";
import {
  bindD1Named,
  type NamedD1Binding,
} from "~/lib/d1-bind.server";
import { chunkForBoundParams } from "~/lib/d1-chunk.server";
import type { AppEnv } from "~/lib/env.server";
import { isAdLibraryChromeCta } from "~/lib/meta-library-rendered-card-parser.server";
import type { AdRecord, AnalysisFieldInput } from "~/lib/types";

interface AdLookupRow {
  id: string;
  raw_json: string;
  advertiser: string;
  body: string;
  body_secondary: string | null;
  preview_headline: string;
  preview_subhead: string;
  hook: string;
  offer_text: string;
  cta: string;
  creative_format: AdRecord["format"];
  language_label: string;
  destination_type: AdRecord["destinationType"];
  landing_page_url: string | null;
  ad_snapshot_url: string | null;
  countries_json: string;
  platforms_json: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  is_active: number;
  source: AdRecord["source"];
  research_summary: string;
  creative_text: string | null;
  creative_text_capture_method: AdRecord["creativeTextCaptureMethod"];
  creative_text_metadata_json: string | null;
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

async function many<T>(
  env: AppEnv,
  sql: string,
  bindings: readonly NamedD1Binding[],
) {
  const db = ensureDb(env);
  const result = await bindD1Named(db.prepare(sql), bindings).all<T>();
  return result.results ?? [];
}

async function run(
  env: AppEnv,
  sql: string,
  bindings: readonly NamedD1Binding[],
) {
  const db = ensureDb(env);
  await bindD1Named(db.prepare(sql), bindings).run();
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

function normalizeSeenAt(value: string | null) {
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

function findTranslatedAnalysisField(fields: AnalysisFieldInput[]) {
  return fields.find((field) => field.fieldKey === "translated_text" && field.fieldValue.trim()) ?? null;
}

function mergePersistedAnalysisFields(
  fields: AnalysisFieldInput[],
  storedFields: AnalysisFieldInput[],
  ad: Pick<AdRecord, "hook" | "offer" | "source">,
) {
  const merged = new Map(
    storedFields.map((field) => [`${field.scopeType}:${field.fieldKey}`, field]),
  );
  const incomingSource = mapAdSourceToAnalysisSource(ad.source);
  if (!ad.hook.trim() && merged.get("ad:hook")?.provenanceSource === incomingSource) {
    merged.delete("ad:hook");
  }
  if (!ad.offer.trim() && merged.get("ad:offer")?.provenanceSource === incomingSource) {
    merged.delete("ad:offer");
  }
  for (const field of fields) {
    merged.set(`${field.scopeType}:${field.fieldKey}`, field);
  }
  return [...merged.values()];
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
          SELECT
            id, raw_json, advertiser, body, body_secondary, preview_headline,
            preview_subhead, hook, offer_text, cta, creative_format,
            language_label, destination_type, landing_page_url, ad_snapshot_url,
            countries_json, platforms_json, first_seen_at, last_seen_at,
            is_active, source, research_summary, creative_text,
            creative_text_capture_method, creative_text_metadata_json
          FROM ad
          WHERE id IN (${placeholders})
        `,
        chunk.map(
          (adId, index) =>
            [`adIds[${index}]`, adId] as const,
        ),
      );
    }),
  );
  const adsById = new Map<string, AdRecord>();

  for (const row of chunkedRows.flat()) {
    const raw = parseJson<Partial<AdRecord> | null>(row.raw_json, null) ?? {};
    // FIX-14 read side: rows captured before the extraction-side chrome-CTA
    // guard landed can still carry a pure Meta Ad Library chrome value ("Menu",
    // "Open Drop-down", "See ad details", …) in the cta column. This read
    // choke point feeds every persisted-ad consumer (public search selection,
    // creative walls, digests, reports, exports), so drop exact chrome tokens
    // here — real advertiser CTAs always pass (exact match only).
    const ctaValue =
      typeof row.cta === "undefined" ? raw.cta : row.cta;
    const hydrated = {
      ...raw,
      metaAdId: row.id,
      advertiser:
        typeof row.advertiser === "undefined" ? raw.advertiser : row.advertiser,
      body: typeof row.body === "undefined" ? raw.body : row.body,
      bodySecondary: row.body_secondary ?? raw.bodySecondary,
      previewHeadline:
        typeof row.preview_headline === "undefined"
          ? raw.previewHeadline
          : row.preview_headline,
      previewSubhead:
        typeof row.preview_subhead === "undefined"
          ? raw.previewSubhead
          : row.preview_subhead,
      hook: typeof row.hook === "undefined" ? raw.hook : row.hook,
      offer: typeof row.offer_text === "undefined" ? raw.offer : row.offer_text,
      cta: isAdLibraryChromeCta(ctaValue) ? "" : ctaValue,
      format:
        typeof row.creative_format === "undefined"
          ? raw.format
          : row.creative_format,
      languageLabel:
        typeof row.language_label === "undefined"
          ? raw.languageLabel
          : row.language_label,
      destinationType:
        typeof row.destination_type === "undefined"
          ? raw.destinationType
          : row.destination_type,
      landingPageUrl: row.landing_page_url ?? raw.landingPageUrl,
      adSnapshotUrl: row.ad_snapshot_url ?? raw.adSnapshotUrl,
      countries:
        typeof row.countries_json === "undefined"
          ? raw.countries
          : parseJson<string[]>(row.countries_json, []),
      platforms:
        typeof row.platforms_json === "undefined"
          ? raw.platforms
          : parseJson<string[]>(row.platforms_json, []),
      firstSeenAt: row.first_seen_at ?? raw.firstSeenAt,
      lastSeenAt: row.last_seen_at ?? raw.lastSeenAt,
      active:
        typeof row.is_active === "undefined" ? raw.active : row.is_active === 1,
      source: typeof row.source === "undefined" ? raw.source : row.source,
      researchSummary:
        typeof row.research_summary === "undefined"
          ? raw.researchSummary
          : row.research_summary,
      analysisFields: raw.analysisFields ?? [],
      creativeText: row.creative_text ?? raw.creativeText,
      creativeTextCaptureMethod:
        row.creative_text_capture_method ?? raw.creativeTextCaptureMethod,
      creativeTextMetadata:
        row.creative_text_metadata_json == null
          ? raw.creativeTextMetadata
          : parseJson<Record<string, unknown> | null>(
              row.creative_text_metadata_json,
              null,
            ),
    };
    adsById.set(
      row.id,
      Object.fromEntries(
        Object.entries(hydrated).filter((entry) => entry[1] !== undefined),
      ) as unknown as AdRecord,
    );
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
    const hasStoredEvidence = Boolean(
      storedAd?.creativeText
      ?? storedAd?.creativeImageUrl
      ?? storedAd?.creativeTextCaptureMethod
      ?? storedAd?.creativeTextMetadata
      ?? storedAd?.landingPage
      ?? storedAd?.landingPageUrl
      ?? storedAd?.adSnapshotUrl
      ?? (storedAd?.analysisFields.length ? true : null),
    );

    if (!storedAd || (!hasStoredEvidence && !storedTranslatedField)) {
      return ad;
    }

    return {
      ...ad,
      landingPageUrl: ad.landingPageUrl ?? storedAd.landingPageUrl ?? null,
      adSnapshotUrl: ad.adSnapshotUrl ?? storedAd.adSnapshotUrl ?? null,
      landingPage: ad.landingPage ?? storedAd.landingPage ?? null,
      creativeText: ad.creativeText ?? storedAd.creativeText ?? null,
      creativeImageUrl: ad.creativeImageUrl ?? storedAd.creativeImageUrl ?? null,
      creativeTextCaptureMethod:
        ad.creativeTextCaptureMethod ?? storedAd.creativeTextCaptureMethod ?? null,
      creativeTextMetadata:
        ad.creativeTextMetadata ?? storedAd.creativeTextMetadata ?? null,
      analysisFields: mergePersistedAnalysisFields(
        ad.analysisFields,
        storedAd.analysisFields,
        ad,
      ),
    };
  });
}

export async function upsertAd(env: AppEnv, ad: AdRecord) {
  const timestamp = nowIso();
  const firstSeenAt = normalizeSeenAt(ad.firstSeenAt);
  const lastSeenAt = normalizeSeenAt(ad.lastSeenAt);
  const evidenceCapturedAt = latestEvidenceCapturedAt(ad);
  const canonicalRevision = createId();
  const landingPageUrl = ad.landingPageUrl ?? null;
  const adSnapshotUrl = ad.adSnapshotUrl ?? null;
  const rawJson = jsonValue({
    ...ad,
    landingPageUrl,
    adSnapshotUrl,
    firstSeenAt,
    lastSeenAt,
    evidenceCapturedAt,
    canonicalRevision,
  });
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
                    landing_page_url = COALESCE(excluded.landing_page_url, ad.landing_page_url),
                    ad_snapshot_url = COALESCE(excluded.ad_snapshot_url, ad.ad_snapshot_url),
                    countries_json = excluded.countries_json,
                    platforms_json = excluded.platforms_json,
                    first_seen_at = CASE
                      WHEN excluded.first_seen_at IS NULL
                        OR julianday(excluded.first_seen_at) IS NULL
                        THEN CASE
                          WHEN ad.first_seen_at IS NULL
                            OR julianday(ad.first_seen_at) IS NULL THEN NULL
                          ELSE ad.first_seen_at
                        END
                      WHEN ad.first_seen_at IS NULL
                        OR julianday(ad.first_seen_at) IS NULL THEN excluded.first_seen_at
                      WHEN julianday(excluded.first_seen_at) <= julianday(ad.first_seen_at)
                        THEN excluded.first_seen_at
                      ELSE ad.first_seen_at
                    END,
                    last_seen_at = CASE
                      WHEN excluded.last_seen_at IS NULL
                        OR julianday(excluded.last_seen_at) IS NULL
                        THEN CASE
                          WHEN ad.last_seen_at IS NULL
                            OR julianday(ad.last_seen_at) IS NULL THEN NULL
                          ELSE ad.last_seen_at
                        END
                      WHEN ad.last_seen_at IS NULL
                        OR julianday(ad.last_seen_at) IS NULL THEN excluded.last_seen_at
                      WHEN julianday(excluded.last_seen_at) >= julianday(ad.last_seen_at)
                        THEN excluded.last_seen_at
                      ELSE ad.last_seen_at
                    END,
                    is_active = excluded.is_active,
                    source = excluded.source,
                    research_summary = excluded.research_summary,
                    creative_text = CASE
                      WHEN excluded.creative_text IS NULL THEN ad.creative_text
                      WHEN ad.creative_text IS NULL THEN excluded.creative_text
                      WHEN julianday(json_extract(excluded.creative_text_metadata_json, '$.capturedAt')) IS NOT NULL
                        AND (
                          julianday(json_extract(ad.creative_text_metadata_json, '$.capturedAt')) IS NULL
                          OR julianday(json_extract(excluded.creative_text_metadata_json, '$.capturedAt'))
                            >= julianday(json_extract(ad.creative_text_metadata_json, '$.capturedAt'))
                        ) THEN excluded.creative_text
                      ELSE ad.creative_text
                    END,
                    creative_text_capture_method = CASE
                      WHEN julianday(json_extract(excluded.creative_text_metadata_json, '$.capturedAt')) IS NOT NULL
                        AND (
                          julianday(json_extract(ad.creative_text_metadata_json, '$.capturedAt')) IS NULL
                          OR julianday(json_extract(excluded.creative_text_metadata_json, '$.capturedAt'))
                            >= julianday(json_extract(ad.creative_text_metadata_json, '$.capturedAt'))
                        ) THEN excluded.creative_text_capture_method
                      ELSE COALESCE(ad.creative_text_capture_method, excluded.creative_text_capture_method)
                    END,
                    creative_text_metadata_json = CASE
                      WHEN julianday(json_extract(excluded.creative_text_metadata_json, '$.capturedAt')) IS NOT NULL
                        AND (
                          julianday(json_extract(ad.creative_text_metadata_json, '$.capturedAt')) IS NULL
                          OR julianday(json_extract(excluded.creative_text_metadata_json, '$.capturedAt'))
                            >= julianday(json_extract(ad.creative_text_metadata_json, '$.capturedAt'))
                        ) THEN excluded.creative_text_metadata_json
                      ELSE COALESCE(ad.creative_text_metadata_json, excluded.creative_text_metadata_json)
                    END,
                    raw_json = json_set(
                      excluded.raw_json,
                      '$.firstSeenAt',
                      CASE
                        WHEN excluded.first_seen_at IS NULL
                          OR julianday(excluded.first_seen_at) IS NULL
                          THEN CASE
                            WHEN ad.first_seen_at IS NULL
                              OR julianday(ad.first_seen_at) IS NULL THEN NULL
                            ELSE ad.first_seen_at
                          END
                        WHEN ad.first_seen_at IS NULL
                          OR julianday(ad.first_seen_at) IS NULL THEN excluded.first_seen_at
                        WHEN julianday(excluded.first_seen_at) <= julianday(ad.first_seen_at)
                          THEN excluded.first_seen_at
                        ELSE ad.first_seen_at
                      END,
                      '$.lastSeenAt',
                      CASE
                        WHEN excluded.last_seen_at IS NULL
                          OR julianday(excluded.last_seen_at) IS NULL
                          THEN CASE
                            WHEN ad.last_seen_at IS NULL
                              OR julianday(ad.last_seen_at) IS NULL THEN NULL
                            ELSE ad.last_seen_at
                          END
                        WHEN ad.last_seen_at IS NULL
                          OR julianday(ad.last_seen_at) IS NULL THEN excluded.last_seen_at
                        WHEN julianday(excluded.last_seen_at) >= julianday(ad.last_seen_at)
                          THEN excluded.last_seen_at
                        ELSE ad.last_seen_at
                      END,
                      '$.landingPageUrl',
                      COALESCE(
                        json_extract(excluded.raw_json, '$.landingPageUrl'),
                        json_extract(ad.raw_json, '$.landingPageUrl')
                      ),
                      '$.adSnapshotUrl',
                      COALESCE(
                        json_extract(excluded.raw_json, '$.adSnapshotUrl'),
                        json_extract(ad.raw_json, '$.adSnapshotUrl')
                      ),
                      '$.landingPage',
                      json(CASE
                        WHEN json_extract(excluded.raw_json, '$.landingPage') IS NULL
                          THEN COALESCE(json_extract(ad.raw_json, '$.landingPage'), 'null')
                        WHEN json_extract(ad.raw_json, '$.landingPage') IS NULL
                          THEN json_extract(excluded.raw_json, '$.landingPage')
                        WHEN julianday(json_extract(excluded.raw_json, '$.landingPage.capturedAt')) IS NOT NULL
                          AND (
                            julianday(json_extract(ad.raw_json, '$.landingPage.capturedAt')) IS NULL
                            OR julianday(json_extract(excluded.raw_json, '$.landingPage.capturedAt'))
                              >= julianday(json_extract(ad.raw_json, '$.landingPage.capturedAt'))
                          ) THEN json_extract(excluded.raw_json, '$.landingPage')
                        ELSE json_extract(ad.raw_json, '$.landingPage')
                      END),
                      '$.creativeText',
                      CASE
                        WHEN julianday(json_extract(excluded.raw_json, '$.creativeTextMetadata.capturedAt')) IS NOT NULL
                          AND (
                            julianday(json_extract(ad.raw_json, '$.creativeTextMetadata.capturedAt')) IS NULL
                            OR julianday(json_extract(excluded.raw_json, '$.creativeTextMetadata.capturedAt'))
                              >= julianday(json_extract(ad.raw_json, '$.creativeTextMetadata.capturedAt'))
                          ) THEN json_extract(excluded.raw_json, '$.creativeText')
                        ELSE COALESCE(
                          json_extract(ad.raw_json, '$.creativeText'),
                          json_extract(excluded.raw_json, '$.creativeText')
                        )
                      END,
                      '$.creativeImageUrl',
                      CASE
                        WHEN julianday(json_extract(excluded.raw_json, '$.creativeTextMetadata.capturedAt')) IS NOT NULL
                          AND (
                            julianday(json_extract(ad.raw_json, '$.creativeTextMetadata.capturedAt')) IS NULL
                            OR julianday(json_extract(excluded.raw_json, '$.creativeTextMetadata.capturedAt'))
                              >= julianday(json_extract(ad.raw_json, '$.creativeTextMetadata.capturedAt'))
                          ) THEN json_extract(excluded.raw_json, '$.creativeImageUrl')
                        ELSE COALESCE(
                          json_extract(ad.raw_json, '$.creativeImageUrl'),
                          json_extract(excluded.raw_json, '$.creativeImageUrl')
                        )
                      END,
                      '$.creativeTextCaptureMethod',
                      CASE
                        WHEN julianday(json_extract(excluded.raw_json, '$.creativeTextMetadata.capturedAt')) IS NOT NULL
                          AND (
                            julianday(json_extract(ad.raw_json, '$.creativeTextMetadata.capturedAt')) IS NULL
                            OR julianday(json_extract(excluded.raw_json, '$.creativeTextMetadata.capturedAt'))
                              >= julianday(json_extract(ad.raw_json, '$.creativeTextMetadata.capturedAt'))
                          ) THEN json_extract(excluded.raw_json, '$.creativeTextCaptureMethod')
                        ELSE COALESCE(
                          json_extract(ad.raw_json, '$.creativeTextCaptureMethod'),
                          json_extract(excluded.raw_json, '$.creativeTextCaptureMethod')
                        )
                      END,
                      '$.creativeTextMetadata',
                      json(CASE
                        WHEN julianday(json_extract(excluded.raw_json, '$.creativeTextMetadata.capturedAt')) IS NOT NULL
                          AND (
                            julianday(json_extract(ad.raw_json, '$.creativeTextMetadata.capturedAt')) IS NULL
                            OR julianday(json_extract(excluded.raw_json, '$.creativeTextMetadata.capturedAt'))
                              >= julianday(json_extract(ad.raw_json, '$.creativeTextMetadata.capturedAt'))
                          ) THEN COALESCE(json_extract(excluded.raw_json, '$.creativeTextMetadata'), 'null')
                        ELSE COALESCE(
                          json_extract(ad.raw_json, '$.creativeTextMetadata'),
                          json_extract(excluded.raw_json, '$.creativeTextMetadata'),
                          'null'
                        )
                      END),
                      '$.evidenceCapturedAt',
                      CASE
                        WHEN julianday(json_extract(excluded.raw_json, '$.evidenceCapturedAt')) IS NULL
                          THEN json_extract(ad.raw_json, '$.evidenceCapturedAt')
                        WHEN julianday(json_extract(ad.raw_json, '$.evidenceCapturedAt')) IS NULL
                          OR julianday(json_extract(excluded.raw_json, '$.evidenceCapturedAt'))
                            >= julianday(json_extract(ad.raw_json, '$.evidenceCapturedAt'))
                          THEN json_extract(excluded.raw_json, '$.evidenceCapturedAt')
                        ELSE json_extract(ad.raw_json, '$.evidenceCapturedAt')
                      END,
                      '$.analysisFields',
                      json(COALESCE((
                        SELECT json_group_array(json(candidate.value))
                        FROM (
                          SELECT incoming.value AS value
                          FROM json_each(excluded.raw_json, '$.analysisFields') AS incoming
                          LEFT JOIN json_each(ad.raw_json, '$.analysisFields') AS existing
                            ON json_extract(existing.value, '$.scopeType') = json_extract(incoming.value, '$.scopeType')
                            AND json_extract(existing.value, '$.fieldKey') = json_extract(incoming.value, '$.fieldKey')
                          WHERE existing.value IS NULL
                            OR (
                              julianday(json_extract(incoming.value, '$.metadata.capturedAt')) IS NOT NULL
                              AND (
                                julianday(json_extract(existing.value, '$.metadata.capturedAt')) IS NULL
                                OR julianday(json_extract(incoming.value, '$.metadata.capturedAt'))
                                  >= julianday(json_extract(existing.value, '$.metadata.capturedAt'))
                              )
                            )
                            OR (
                              julianday(json_extract(incoming.value, '$.metadata.capturedAt')) IS NULL
                              AND julianday(json_extract(existing.value, '$.metadata.capturedAt')) IS NULL
                            )
                          UNION ALL
                          SELECT existing.value AS value
                          FROM json_each(ad.raw_json, '$.analysisFields') AS existing
                          LEFT JOIN json_each(excluded.raw_json, '$.analysisFields') AS incoming
                            ON json_extract(incoming.value, '$.scopeType') = json_extract(existing.value, '$.scopeType')
                            AND json_extract(incoming.value, '$.fieldKey') = json_extract(existing.value, '$.fieldKey')
                          WHERE (
                              incoming.value IS NULL
                              AND NOT (
                                json_extract(existing.value, '$.scopeType') = 'ad'
                                AND json_extract(existing.value, '$.fieldKey') = 'hook'
                                AND json_extract(existing.value, '$.provenanceSource') = CASE
                                  WHEN json_extract(excluded.raw_json, '$.source') = 'meta_library_browser'
                                    THEN 'meta_library_browser'
                                  WHEN json_extract(excluded.raw_json, '$.source') IN ('meta', 'meta_api')
                                    THEN 'meta_api'
                                  ELSE 'user'
                                END
                                AND TRIM(COALESCE(json_extract(excluded.raw_json, '$.hook'), '')) = ''
                              )
                              AND NOT (
                                json_extract(existing.value, '$.scopeType') = 'ad'
                                AND json_extract(existing.value, '$.fieldKey') = 'offer'
                                AND json_extract(existing.value, '$.provenanceSource') = CASE
                                  WHEN json_extract(excluded.raw_json, '$.source') = 'meta_library_browser'
                                    THEN 'meta_library_browser'
                                  WHEN json_extract(excluded.raw_json, '$.source') IN ('meta', 'meta_api')
                                    THEN 'meta_api'
                                  ELSE 'user'
                                END
                                AND TRIM(COALESCE(json_extract(excluded.raw_json, '$.offer'), '')) = ''
                              )
                            )
                            OR (
                              julianday(json_extract(existing.value, '$.metadata.capturedAt')) IS NOT NULL
                              AND (
                                julianday(json_extract(incoming.value, '$.metadata.capturedAt')) IS NULL
                                OR julianday(json_extract(existing.value, '$.metadata.capturedAt'))
                                  > julianday(json_extract(incoming.value, '$.metadata.capturedAt'))
                              )
                            )
                        ) AS candidate
                      ), '[]'))
                    ),
                    updated_at = excluded.updated_at
    `,
    [
      ["ad.id", ad.metaAdId],
      ["ad.advertiser", ad.advertiser],
      ["ad.body", ad.body],
      ["ad.bodySecondary", ad.bodySecondary, "null"],
      ["ad.previewHeadline", ad.previewHeadline],
      ["ad.previewSubhead", ad.previewSubhead],
      ["ad.hook", ad.hook],
      ["ad.offer", ad.offer],
      ["ad.cta", ad.cta],
      ["ad.format", ad.format],
      ["ad.languageLabel", ad.languageLabel],
      ["ad.destinationType", ad.destinationType],
      ["ad.landingPageUrl", landingPageUrl, "null"],
      ["ad.adSnapshotUrl", adSnapshotUrl, "null"],
      [
        "ad.countries",
        ad.countries === undefined
          ? undefined
          : jsonValue(ad.countries),
      ],
      [
        "ad.platforms",
        ad.platforms === undefined
          ? undefined
          : jsonValue(ad.platforms),
      ],
      ["ad.firstSeenAt", firstSeenAt],
      ["ad.lastSeenAt", lastSeenAt],
      [
        "ad.active",
        ad.active === undefined ? undefined : ad.active ? 1 : 0,
      ],
      ["ad.source", ad.source],
      ["ad.researchSummary", ad.researchSummary],
      ["ad.creativeText", ad.creativeText, "null"],
      [
        "ad.creativeTextCaptureMethod",
        ad.creativeTextCaptureMethod,
        "null",
      ],
      [
        "ad.creativeTextMetadata",
        ad.creativeTextMetadata
          ? jsonValue(ad.creativeTextMetadata)
          : null,
      ],
      ["ad.rawJson", rawJson],
      ["ad.createdAt", timestamp],
      ["ad.updatedAt", timestamp],
    ],
  );

  const [persistedAd] = await listAdsByIds(env, [ad.metaAdId]);
  const analysisAd = persistedAd ?? ad;
  await replaceAnalysisFields(
    env,
    "ad",
    ad.metaAdId,
    analysisAd.analysisFields.length > 0
      ? analysisAd.analysisFields
      : buildAnalysisFields(analysisAd, mapAdSourceToAnalysisSource(analysisAd.source)),
    { canonicalRevision },
  );
}

function latestEvidenceCapturedAt(ad: AdRecord) {
  const creativeCapturedAt = typeof ad.creativeTextMetadata?.capturedAt === "string"
    ? ad.creativeTextMetadata.capturedAt
    : null;
  const candidates = [ad.landingPage?.capturedAt ?? null, creativeCapturedAt]
    .filter((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  return candidates.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

export async function replaceAnalysisFields(
  env: AppEnv,
  scopeType: "ad" | "observation" | "landing_page",
  scopeId: string,
  fields: AnalysisFieldInput[],
  options: { canonicalRevision?: string | null } = {},
) {
  const db = ensureDb(env);
  const timestamp = nowIso();
  const canonicalRevision = options.canonicalRevision ?? null;
  const projectionGuard = canonicalRevision && scopeType === "ad"
    ? " AND EXISTS (SELECT 1 FROM ad WHERE id = ? AND json_extract(raw_json, '$.canonicalRevision') = ?)"
    : "";
  const statements = [
    bindD1Named(
      db.prepare(
        `DELETE FROM analysis_field WHERE scope_type = ? AND scope_id = ?${projectionGuard}`,
      ),
      [
        ["analysisField.scopeType", scopeType],
        ["analysisField.scopeId", scopeId],
        ...(projectionGuard
          ? ([
              ["analysisField.projectionScopeId", scopeId],
              [
                "analysisField.canonicalRevision",
                canonicalRevision,
              ],
            ] satisfies NamedD1Binding[])
          : []),
      ],
    ),
  ];

  for (const field of fields) {
    statements.push(
      bindD1Named(
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
          ${projectionGuard
            ? "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ad WHERE id = ? AND json_extract(raw_json, '$.canonicalRevision') = ?)"
            : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"}
        `),
        [
          ["analysisField.id", createId()],
          ["analysisField.scopeType", scopeType],
          ["analysisField.scopeId", scopeId],
          ["analysisField.fieldKey", field.fieldKey],
          ["analysisField.fieldValue", field.fieldValue],
          ["analysisField.provenanceSource", field.provenanceSource],
          ["analysisField.extractorVersion", field.extractorVersion],
          ["analysisField.confidence", field.confidence, "null"],
          [
            "analysisField.metadata",
            jsonValue(field.metadata ?? null),
          ],
          ["analysisField.createdAt", timestamp],
          ["analysisField.updatedAt", timestamp],
          ...(projectionGuard
            ? ([
                ["analysisField.projectionScopeId", scopeId],
                [
                  "analysisField.canonicalRevision",
                  canonicalRevision,
                ],
              ] satisfies NamedD1Binding[])
            : []),
        ],
      ),
    );
  }

  await db.batch(statements);
}
