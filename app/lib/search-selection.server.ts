import { withStructuredAnalysis } from "~/lib/analysis.server";
import { captureCreativeText } from "~/lib/creative-text.server";
import {
  hydrateAdsWithPersistedCreatives,
  upsertAd,
} from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import { captureLandingPageSnapshot } from "~/lib/landing-pages.server";
import type { AdRecord, SearchResponse } from "~/lib/types";

export async function prepareSearchResultSelection(
  env: AppEnv,
  result: SearchResponse,
  selectedId: string | null,
) {
  const hydratedAds = await hydrateAdsWithPersistedCreatives(env, result.ads);
  const resolvedSelectedId = selectedId ?? hydratedAds[0]?.metaAdId ?? null;
  const selectedAdBase = hydratedAds.find((ad) => ad.metaAdId === resolvedSelectedId) ?? hydratedAds[0] ?? null;

  let selectedAd: AdRecord | null = selectedAdBase;
  if (selectedAdBase) {
    const [snapshot, creativeText] = await Promise.all([
      selectedAdBase.landingPageUrl
        ? captureLandingPageSnapshot(env, selectedAdBase.landingPageUrl)
        : Promise.resolve(null),
      selectedAdBase.source === "meta" && selectedAdBase.adSnapshotUrl && !selectedAdBase.creativeText
        ? captureCreativeText(env, selectedAdBase.adSnapshotUrl, selectedAdBase)
        : Promise.resolve(null),
    ]);

    if (snapshot || creativeText) {
      selectedAd = withStructuredAnalysis({
        ...selectedAdBase,
        landingPage: snapshot ?? selectedAdBase.landingPage ?? null,
        creativeText: creativeText?.text ?? selectedAdBase.creativeText ?? null,
        creativeTextCaptureMethod:
          creativeText?.captureMethod ?? selectedAdBase.creativeTextCaptureMethod ?? null,
        creativeTextMetadata:
          creativeText?.metadata ?? selectedAdBase.creativeTextMetadata ?? null,
      });

      if (creativeText && selectedAd.source === "meta") {
        await upsertAd(env, selectedAd);
      }
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
