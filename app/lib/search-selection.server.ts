import { withStructuredAnalysis } from "~/lib/analysis.server";
import { isAdLibraryBackedAd } from "~/lib/ad-source-kind";
import { captureCreativeText } from "~/lib/creative-text.server";
import {
  hydrateAdsWithPersistedCreatives,
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
    const [snapshot, creativeText] = await Promise.all([
      selectedAdBase.landingPageUrl
        ? captureLandingPageSnapshot(env, selectedAdBase.landingPageUrl)
        : Promise.resolve(null),
      isAdLibraryBackedAd(selectedAdBase) && selectedAdBase.adSnapshotUrl && !selectedAdBase.creativeText
        ? captureCreativeText(env, selectedAdBase.adSnapshotUrl, selectedAdBase)
        : Promise.resolve(null),
    ]);

    const nextSelectedAdBase = {
      ...selectedAdBase,
      landingPage: snapshot ?? selectedAdBase.landingPage ?? null,
      creativeText: creativeText?.text ?? selectedAdBase.creativeText ?? null,
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

    if (creativeText && isAdLibraryBackedAd(selectedAd)) {
      await upsertAd(env, selectedAd);
    }

    const translationResult = await translateAdText(env, selectedAd);
    if (translationResult) {
      const translatedField = buildTranslatedAnalysisField(translationResult);
      selectedAd = {
        ...selectedAd,
        analysisFields: withTranslatedAnalysisField(selectedAd.analysisFields, translatedField),
      };
      await upsertAd(env, selectedAd);
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
