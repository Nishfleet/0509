/** Honest display copy when no explicit offer phrase was extracted. */
export const NO_EXPLICIT_OFFER_LABEL = "No explicit offer detected";

export function formatOfferDisplay(offer: string | null | undefined) {
  const trimmed = offer?.trim() || "";
  return trimmed || NO_EXPLICIT_OFFER_LABEL;
}

/** Pluralize ad-count labels for search results headers. */
export function formatAdsFoundLabel(count: number) {
  const safe = Math.max(0, Math.floor(count));
  return safe === 1 ? "1 ad found" : `${safe} ads found`;
}
