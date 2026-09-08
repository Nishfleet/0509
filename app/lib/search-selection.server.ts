import { withStructuredAnalysis } from "~/lib/analysis.server";
import { mapAdSourceToAnalysisSource } from "~/lib/ad-source-kind";
import { shouldAttemptCreativeTextCapture } from "~/lib/creative-capture-policy";
import { captureCreativeText } from "~/lib/creative-text.server";
import {
  hydrateAdsWithPersistedCreatives,
  listAdsByIds,
  upsertAd,
} from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import type { BrowserJobPlanTier } from "~/lib/browser-job-telemetry.server";
import {
  captureLandingPageSnapshot,
  type LandingPageCaptureFailureDetail,
} from "~/lib/landing-pages.server";
import {
  buildTranslatedAnalysisField,
  translateAdText,
  withTranslatedAnalysisField,
} from "~/lib/translation.server";
import { pickFeaturedProofAd, sortAdsForSearchDisplay } from "~/lib/search-sort";
import type { AdRecord, SearchResponse } from "~/lib/types";

export type PrepareSearchResultSelectionOptions = {
  enrichSelected?: boolean;
  hydratePersisted?: boolean;
  /**
   * When false, landing capture stays fetch-only. Omitted / undefined keeps
   * today's default: rendered fallback on (`allowRenderedFallback !== false`).
   */
  allowRenderedFallback?: boolean;
  /**
   * WP-11: when set, expensive OCR / landing / translation run in the
   * background via waitUntil and the loader returns the base ad immediately.
   * Tests and non-Worker callers omit this and keep the synchronous path.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Resolved plan family of the signed-in actor, recorded on the
   * selection-enrichment landing telemetry rows. Anonymous visitors omit it.
   */
  planTier?: BrowserJobPlanTier | null;
};

type EnrichAndPersistSelectedAdOptions = {
  planTier: BrowserJobPlanTier | null;
  allowRenderedFallback: boolean;
  persistSelected: boolean;
  captureCreativeAndTranslation: boolean;
};

/** FIX-13: prevent a revalidation from scheduling a second enrichment while one runs. */
const ENRICHMENT_IN_FLIGHT_MS = 90_000;
const enrichmentInFlightStartedAt = new Map<string, number>();

function tryClaimSelectionEnrichment(metaAdId: string, nowMs: number = Date.now()): boolean {
  const started = enrichmentInFlightStartedAt.get(metaAdId);
  if (started != null && nowMs - started < ENRICHMENT_IN_FLIGHT_MS) {
    return false;
  }
  enrichmentInFlightStartedAt.set(metaAdId, nowMs);
  return true;
}

function releaseSelectionEnrichment(metaAdId: string) {
  enrichmentInFlightStartedAt.delete(metaAdId);
}

/** Test helper — clear in-flight enrichment claims between cases. */
export function resetSelectionEnrichmentInFlightForTests() {
  enrichmentInFlightStartedAt.clear();
}

export function selectionNeedsEnrichment(ad: AdRecord): boolean {
  const needsLanding = Boolean(ad.landingPageUrl?.trim()) && !ad.landingPage;
  const needsCreative = shouldAttemptCreativeTextCapture(ad);
  const hasTranslatedField = ad.analysisFields.some(
    (field) => field.fieldKey === "translated_text" && Boolean(field.fieldValue?.trim()),
  );
  // Translation only matters when language is non-English-looking and we lack a field.
  const language = (ad.languageLabel ?? "").trim().toLowerCase();
  const looksEnglish =
    !language ||
    language === "english" ||
    language === "en" ||
    language.startsWith("en-") ||
    language === "unknown" ||
    language === "ambiguous";
  const needsTranslation = !looksEnglish && !hasTranslatedField;
  return needsLanding || needsCreative || needsTranslation;
}

export async function prepareSearchResultSelection(
  env: AppEnv,
  result: SearchResponse,
  selectedId: string | null,
  options: PrepareSearchResultSelectionOptions = {},
) {
  const rawHydratedAds = options.hydratePersisted === false
    ? result.ads
    : await hydrateAdsWithPersistedCreatives(env, result.ads);
  // Active-first, longest-running for display + featured proof default.
  const hydratedAds = sortAdsForSearchDisplay(rawHydratedAds, "active_first");
  const featured = pickFeaturedProofAd(hydratedAds);
  const selectedAdBase = selectedId
    ? hydratedAds.find((ad) => ad.metaAdId === selectedId) ?? null
    : featured ?? null;

  let selectedAd: AdRecord | null = selectedAdBase;
  let selectionEnrichmentPending = false;
  let landingPageCaptureFailure: LandingPageCaptureFailureDetail | null = null;
  const providerResultIsFresh = result.cacheStatus === "miss";

  if (selectedAdBase && options.enrichSelected !== false) {
    const anonymousLandingOnly = options.hydratePersisted === false;
    const needsWork = anonymousLandingOnly
      ? Boolean(selectedAdBase.landingPageUrl?.trim()) &&
        !selectedAdBase.landingPage &&
        selectedAdBase.source !== "demo"
      : selectionNeedsEnrichment(selectedAdBase);
    const enrichOptions: EnrichAndPersistSelectedAdOptions = {
      planTier: options.planTier ?? null,
      allowRenderedFallback: options.allowRenderedFallback !== false,
      persistSelected: Boolean(env.DB) && options.hydratePersisted !== false,
      captureCreativeAndTranslation: options.hydratePersisted !== false,
    };
    if (needsWork && options.waitUntil) {
      // WP-11 paint-fast path: return base ad now; finish enrichment async.
      // FIX-13: revalidations must not schedule a second enrichment while one
      // is already in flight for this ad.
      const claimed = tryClaimSelectionEnrichment(selectedAdBase.metaAdId);
      selectionEnrichmentPending = true;
      if (claimed) {
        options.waitUntil(
          enrichAndPersistSelectedAd(env, selectedAdBase, providerResultIsFresh, enrichOptions)
            .catch((error) => {
              // Background enrichment must never throw into the Worker isolate.
              console.warn(
                JSON.stringify({
                  event: "search_selection_enrichment_failed",
                  errorName: error instanceof Error ? error.name : "UnknownError",
                }),
              );
            })
            .finally(() => {
              releaseSelectionEnrichment(selectedAdBase.metaAdId);
            }),
        );
      }
    } else if (needsWork) {
      // Synchronous path (tests / no ExecutionContext / anonymous public
      // search): the snapshot must land in this response. Anonymous captures
      // are not persisted, so a waitUntil handoff would throw the result away
      // and the detail pane would keep showing a capture gap.
      const enriched = await enrichAndPersistSelectedAd(
        env,
        selectedAdBase,
        providerResultIsFresh,
        enrichOptions,
      );
      selectedAd = enriched.ad;
      landingPageCaptureFailure = enriched.landingPageCaptureFailure;
    }
    // When needsWork is false, hydrated/persisted evidence already filled the
    // slots — return base (with persisted creatives) and skip duplicate work.
  }

  return {
    result: {
      ...result,
      ads: hydratedAds,
    },
    selectedAd,
    selectionEnrichmentPending,
    landingPageCaptureFailure,
  };
}

async function enrichAndPersistSelectedAd(
  env: AppEnv,
  selectedAdBase: AdRecord,
  providerResultIsFresh: boolean,
  {
    planTier,
    allowRenderedFallback,
    persistSelected,
    captureCreativeAndTranslation,
  }: EnrichAndPersistSelectedAdOptions,
): Promise<{
  ad: AdRecord;
  landingPageCaptureFailure: LandingPageCaptureFailureDetail | null;
}> {
  const creativeSourceUrl =
    selectedAdBase.adSnapshotUrl?.trim() ||
    selectedAdBase.creativeImageUrl?.trim() ||
    null;
  const creativeCapturePromise =
    captureCreativeAndTranslation &&
    creativeSourceUrl &&
    shouldAttemptCreativeTextCapture(selectedAdBase)
      ? captureCreativeText(
          env,
          creativeSourceUrl,
          selectedAdBase,
        ).then((value) => ({
          value,
          capturedAt:
            typeof value?.metadata.capturedAt === "string"
              ? value.metadata.capturedAt
              : null,
        }))
      : Promise.resolve({ value: null, capturedAt: null });
  let landingPageCaptureFailure: LandingPageCaptureFailureDetail | null = null;
  const [snapshot, creativeCapture] = await Promise.all([
    selectedAdBase.landingPageUrl && !selectedAdBase.landingPage
      ? captureLandingPageSnapshot(env, selectedAdBase.landingPageUrl, {
          persistArtifacts: persistSelected,
          routeContext: "selection_enrichment",
          planTier,
          ...(allowRenderedFallback ? {} : { allowRenderedFallback: false }),
          onFailure: (detail) => {
            landingPageCaptureFailure = detail;
          },
        })
      : Promise.resolve(selectedAdBase.landingPage ?? null),
    creativeCapturePromise,
  ]);
  if (snapshot) {
    landingPageCaptureFailure = null;
  }
  const creativeText = creativeCapture.value;
  const creativeCapturedAt = creativeCapture.capturedAt;

  const nextSelectedAdBase = {
    ...selectedAdBase,
    landingPage: snapshot ?? selectedAdBase.landingPage ?? null,
    creativeText: creativeText?.text ?? selectedAdBase.creativeText ?? null,
    creativeImageUrl: creativeText?.imageUrl ?? selectedAdBase.creativeImageUrl ?? null,
    creativeTextCaptureMethod:
      creativeText?.captureMethod ?? selectedAdBase.creativeTextCaptureMethod ?? null,
    creativeTextMetadata:
      creativeText?.metadata ?? selectedAdBase.creativeTextMetadata ?? null,
  };
  const rebuiltSelectedAd = withStructuredAnalysis(nextSelectedAdBase);
  const rebuiltFieldKeys = new Set(
    rebuiltSelectedAd.analysisFields.map((field) => `${field.scopeType}:${field.fieldKey}`),
  );

  let selectedAd: AdRecord = {
    ...rebuiltSelectedAd,
    analysisFields: [
      ...rebuiltSelectedAd.analysisFields,
      ...selectedAdBase.analysisFields.filter(
        (field) => !rebuiltFieldKeys.has(`${field.scopeType}:${field.fieldKey}`),
      ),
    ],
  };

  if (captureCreativeAndTranslation) {
    const translationResult = await translateAdText(env, selectedAd);
    if (translationResult) {
      const translatedField = buildTranslatedAnalysisField(translationResult);
      selectedAd = {
        ...selectedAd,
        analysisFields: withTranslatedAnalysisField(selectedAd.analysisFields, translatedField),
      };
    }
  }

  // The collection action accepts only this server-persisted canonical ad
  // id. Query-scoped matching metadata must never become shared canonical
  // state, and a cached/capture-failed selection must not erase richer
  // evidence written by an earlier selection.
  if (persistSelected) {
    const selectedForPersistence = creativeCapturedAt
      ? withCreativeCaptureTimestamp(selectedAd, creativeCapturedAt)
      : selectedAd;
    const [storedAd] = await listAdsByIds(env, [selectedAd.metaAdId]);
    await upsertAd(
      env,
      canonicalSelectionAd(selectedForPersistence, storedAd ?? null, providerResultIsFresh),
    );
  }

  return { ad: selectedAd, landingPageCaptureFailure };
}

function canonicalSelectionAd(
  selectedAd: AdRecord,
  storedAd: AdRecord | null,
  providerResultIsFresh: boolean,
): AdRecord {
  const { domainMatch: _queryScopedDomainMatch, ...withoutQueryScope } = selectedAd;
  if (!storedAd) {
    return withoutQueryScope;
  }
  const { domainMatch: _storedQueryScope, ...storedCanonical } = storedAd;

  const analysisFields = new Map(
    storedCanonical.analysisFields.map((field) => [`${field.scopeType}:${field.fieldKey}`, field]),
  );
  const incomingAnalysisSource = mapAdSourceToAnalysisSource(withoutQueryScope.source);
  if (
    providerResultIsFresh &&
    !withoutQueryScope.hook.trim() &&
    analysisFields.get("ad:hook")?.provenanceSource === incomingAnalysisSource
  ) {
    analysisFields.delete("ad:hook");
  }
  if (
    providerResultIsFresh &&
    !withoutQueryScope.offer.trim() &&
    analysisFields.get("ad:offer")?.provenanceSource === incomingAnalysisSource
  ) {
    analysisFields.delete("ad:offer");
  }
  for (const field of withoutQueryScope.analysisFields) {
    const key = `${field.scopeType}:${field.fieldKey}`;
    const storedField = analysisFields.get(key);
    if (!storedField || providerResultIsFresh || shouldPreferCapturedEvidence(
      analysisFieldCapturedAt(field),
      analysisFieldCapturedAt(storedField),
    )) {
      analysisFields.set(key, field);
    }
  }

  const useIncomingLandingPage = shouldPreferCapturedEvidence(
    withoutQueryScope.landingPage?.capturedAt ?? null,
    storedCanonical.landingPage?.capturedAt ?? null,
  );
  const landingPage = useIncomingLandingPage
    ? withoutQueryScope.landingPage
    : storedCanonical.landingPage ?? withoutQueryScope.landingPage ?? null;
  const useIncomingCreative = shouldPreferCapturedEvidence(
    metadataCapturedAt(withoutQueryScope.creativeTextMetadata),
    metadataCapturedAt(storedCanonical.creativeTextMetadata),
  );
  const creativeSource = useIncomingCreative ? withoutQueryScope : storedCanonical;

  return {
    ...storedCanonical,
    ...(providerResultIsFresh ? withoutQueryScope : {}),
    landingPageUrl: withoutQueryScope.landingPageUrl ?? storedCanonical.landingPageUrl ?? null,
    adSnapshotUrl: withoutQueryScope.adSnapshotUrl ?? storedCanonical.adSnapshotUrl ?? null,
    landingPage,
    creativeText: creativeSource.creativeText ?? withoutQueryScope.creativeText ?? storedCanonical.creativeText ?? null,
    creativeImageUrl:
      creativeSource.creativeImageUrl ?? withoutQueryScope.creativeImageUrl ?? storedCanonical.creativeImageUrl ?? null,
    creativeTextCaptureMethod:
      creativeSource.creativeTextCaptureMethod
      ?? withoutQueryScope.creativeTextCaptureMethod
      ?? storedCanonical.creativeTextCaptureMethod
      ?? null,
    creativeTextMetadata:
      creativeSource.creativeTextMetadata
      ?? withoutQueryScope.creativeTextMetadata
      ?? storedCanonical.creativeTextMetadata
      ?? null,
    firstSeenAt: earliestSeenAt(storedCanonical.firstSeenAt, withoutQueryScope.firstSeenAt),
    lastSeenAt: latestSeenAt(storedCanonical.lastSeenAt, withoutQueryScope.lastSeenAt),
    analysisFields: [...analysisFields.values()],
    evidenceCapturedAt: latestCapturedAt(
      landingPage?.capturedAt ?? null,
      metadataCapturedAt(creativeSource.creativeTextMetadata),
    ),
  };
}

function withCreativeCaptureTimestamp(ad: AdRecord, capturedAt: string): AdRecord {
  return {
    ...ad,
    creativeTextMetadata: {
      ...(ad.creativeTextMetadata ?? {}),
      capturedAt,
    },
    analysisFields: ad.analysisFields.map((field) => (
      field.fieldKey === "ocr_text" || field.fieldKey === "translated_text"
    )
      ? { ...field, metadata: { ...(field.metadata ?? {}), capturedAt } }
      : field),
  };
}

function analysisFieldCapturedAt(field: AdRecord["analysisFields"][number]) {
  return metadataCapturedAt(field.metadata);
}

function metadataCapturedAt(metadata: Record<string, unknown> | null | undefined) {
  return typeof metadata?.capturedAt === "string" ? metadata.capturedAt : null;
}

function shouldPreferCapturedEvidence(incoming: string | null, stored: string | null) {
  const incomingTime = incoming ? Date.parse(incoming) : Number.NaN;
  const storedTime = stored ? Date.parse(stored) : Number.NaN;
  if (Number.isNaN(incomingTime)) return false;
  if (Number.isNaN(storedTime)) return true;
  return incomingTime >= storedTime;
}

function latestCapturedAt(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function earliestSeenAt(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function latestSeenAt(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
