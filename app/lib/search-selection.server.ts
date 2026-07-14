import { withStructuredAnalysis } from "~/lib/analysis.server";
import { isAdLibraryBackedAd } from "~/lib/ad-source-kind";
import { captureCreativeText } from "~/lib/creative-text.server";
import {
  hydrateAdsWithPersistedCreatives,
  listAdsByIds,
  upsertAd,
} from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import { captureLandingPageSnapshot } from "~/lib/landing-pages.server";
import {
  buildTranslatedAnalysisField,
  translateAdText,
  withTranslatedAnalysisField,
} from "~/lib/translation.server";
import type { AdRecord, SearchResponse } from "~/lib/types";

export async function prepareSearchResultSelection(
  env: AppEnv,
  result: SearchResponse,
  selectedId: string | null,
  options: { enrichSelected?: boolean; hydratePersisted?: boolean } = {},
) {
  const hydratedAds = options.hydratePersisted === false
    ? result.ads
    : await hydrateAdsWithPersistedCreatives(env, result.ads);
  const resolvedSelectedId = selectedId ?? hydratedAds[0]?.metaAdId ?? null;
  const selectedAdBase = hydratedAds.find((ad) => ad.metaAdId === resolvedSelectedId) ?? hydratedAds[0] ?? null;

  let selectedAd: AdRecord | null = selectedAdBase;
  if (selectedAdBase && options.enrichSelected !== false) {
    const creativeCapturePromise =
      isAdLibraryBackedAd(selectedAdBase) && selectedAdBase.adSnapshotUrl && !selectedAdBase.creativeText
        ? captureCreativeText(env, selectedAdBase.adSnapshotUrl, selectedAdBase).then((value) => ({
            value,
            capturedAt: value ? new Date().toISOString() : null,
          }))
        : Promise.resolve({ value: null, capturedAt: null });
    const [snapshot, creativeCapture] = await Promise.all([
      selectedAdBase.landingPageUrl
        ? captureLandingPageSnapshot(env, selectedAdBase.landingPageUrl)
        : Promise.resolve(null),
      creativeCapturePromise,
    ]);
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

    selectedAd = {
      ...rebuiltSelectedAd,
      analysisFields: [
        ...rebuiltSelectedAd.analysisFields,
        ...selectedAdBase.analysisFields.filter(
          (field) => !rebuiltFieldKeys.has(`${field.scopeType}:${field.fieldKey}`),
        ),
      ],
    };

    const translationResult = await translateAdText(env, selectedAd);
    if (translationResult) {
      const translatedField = buildTranslatedAnalysisField(translationResult);
      selectedAd = {
        ...selectedAd,
        analysisFields: withTranslatedAnalysisField(selectedAd.analysisFields, translatedField),
      };
    }

    // The collection action accepts only this server-persisted canonical ad
    // id. Query-scoped matching metadata must never become shared canonical
    // state, and a cached/capture-failed selection must not erase richer
    // evidence written by an earlier selection.
    if (env.DB) {
      const selectedForPersistence = creativeCapturedAt
        ? withCreativeCaptureTimestamp(selectedAd, creativeCapturedAt)
        : selectedAd;
      const [storedAd] = await listAdsByIds(env, [selectedAd.metaAdId]);
      await upsertAd(
        env,
        canonicalSelectionAd(selectedForPersistence, storedAd ?? null, result.cacheStatus === "miss"),
      );
    }
  }

  return {
    result: {
      ...result,
      ads: hydratedAds,
    },
    selectedAd,
  };
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
