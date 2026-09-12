// Issue #2987 — public projection for anonymous /search documents.
//
// The search loader used to hand its full internal analysis structure to the
// anonymous browser: per-field confidence, extractorVersion, classifier
// metadata (scriptSignals / decisionReason) inside analysisFields metadata,
// and creative-capture metadata. That is competitive IP readable by any
// scraper plus real payload weight. Signed-in users keep the internal
// structure; anonymous requests get only the fields the UI renders.
import type { AdRecord, SearchResponse } from "./types";

/**
 * Anonymous documents render the creative/translation text in the detail
 * pane, so those two fieldValues survive the projection. Everything else in
 * the field list (provenance, confidence, extractor version, classifier
 * metadata) is internal and stripped.
 */
const PUBLIC_ANALYSIS_FIELD_KEYS = new Set(["ocr_text", "translated_text"]);

export function projectAdRecordForPublic(ad: AdRecord): AdRecord {
  const projected: AdRecord = {
    ...ad,
    analysisFields: ad.analysisFields
      .filter((field) => PUBLIC_ANALYSIS_FIELD_KEYS.has(field.fieldKey))
      .map((field) => ({
        // The public shape keeps only what the UI renders (fieldValue); the
        // type-level required fields are filled with non-leaking markers.
        scopeType: field.scopeType,
        fieldKey: field.fieldKey,
        fieldValue: field.fieldValue,
        provenanceSource: field.provenanceSource,
        // NOT the real extractor version — the internal value never leaves
        // the server on the anonymous surface.
        extractorVersion: "public",
      })),
  };
  // Strip capture metadata only when the ad actually carries evidence so a
  // bare payload ad stays byte-identical to the pre-projection shape.
  if (projected.creativeTextMetadata) {
    projected.creativeTextMetadata = null;
  }
  if (projected.landingPage) {
    // Capture metadata can carry internal probe details; the anonymous UI
    // renders nothing from it. Destructured out (not set to undefined) so
    // the projected key set matches the un-projected one.
    const { metadata: _strippedCaptureMetadata, ...publicLandingPage } =
      projected.landingPage;
    projected.landingPage = publicLandingPage;
  }
  return projected;
}

export function projectSearchResponseForPublic(result: SearchResponse): SearchResponse {
  return { ...result, ads: result.ads.map(projectAdRecordForPublic) };
}

export function projectAnonymousSearchPayload({
  result,
  selectedAd,
}: {
  result: SearchResponse;
  selectedAd: AdRecord | null;
}): { result: SearchResponse; selectedAd: AdRecord | null } {
  const projectedResult = projectSearchResponseForPublic(result);
  // The selected ad is also handed to the client separately in the loader
  // payload; project it too (it may not be present in result.ads when
  // featured/searched selection picks the same reference — projection is
  // idempotent so double-projection is harmless either way).
  return {
    result: projectedResult,
    selectedAd: selectedAd ? projectAdRecordForPublic(selectedAd) : null,
  };
}
