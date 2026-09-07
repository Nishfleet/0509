import type { AdRecord, AnalysisSource } from "~/lib/types";

export function isAdLibraryBackedAd(ad: Pick<AdRecord, "source">) {
  return ad.source === "meta" || ad.source === "meta_api" || ad.source === "meta_library_browser";
}

export function mapAdSourceToAnalysisSource(source: AdRecord["source"]): AnalysisSource {
  if (source === "meta_library_browser") {
    return "meta_library_browser";
  }

  if (source === "meta" || source === "meta_api") {
    return "meta_api";
  }

  return "user";
}
