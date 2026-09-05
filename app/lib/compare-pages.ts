/**
 * Shared compare-page facts used by the compare hub, compare routes, and
 * social-card generation so the "Five to Nine vs X" wording never drifts.
 */

export type CompareSlug =
  | "magicbrief"
  | "meta-ad-library"
  | "visualping"
  | "visualping-ad-library"
  | "spyland"
  | "pulzifi"
  | "foreplay"
  | "foreplay-spyder"
  | "panoramata"
  | "adspyder";

export const COMPARE_PRODUCT_NAMES: Record<CompareSlug, string> = {
  magicbrief: "MagicBrief",
  "meta-ad-library": "the Meta Ad Library by hand",
  visualping: "Visualping",
  "visualping-ad-library": "Visualping for ad libraries",
  spyland: "Spyland",
  pulzifi: "Pulzifi",
  foreplay: "Foreplay",
  "foreplay-spyder": "Foreplay Spyder",
  panoramata: "Panoramata",
  adspyder: "AdSpyder",
};

export function comparePagePathname(slug: CompareSlug): `/compare/${CompareSlug}` {
  return `/compare/${slug}`;
}
