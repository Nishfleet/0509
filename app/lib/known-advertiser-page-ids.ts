import { normalizeNumericPageId } from "~/lib/normalize";

/**
 * Verified Meta Page ids for domains whose keyword scrape returns 0 cards
 * even though the Ad Library has the brand's own ads under `view_all_page_id`.
 *
 * Live-checked 2026-09-08 against facebook.com/ads/library:
 * - slack.com → Slack HQ delegate page, ~2,000 results (not the 1000… profile id)
 * - tcs.com → Tata Consultancy Services delegate page, ~33 results
 *
 * Only add a row after a page-scoped Ad Library URL returns the brand's own
 * ads. Do not guess from a Facebook profile URL — the profile id and the Ad
 * Library `view_all_page_id` are often different tokens.
 */
export const KNOWN_ADVERTISER_PAGE_IDS: Readonly<Record<string, string>> = {
  "slack.com": "473141349450143",
  "tcs.com": "19549406249",
};

export function resolveKnownAdvertiserPageId(
  domain: string | null | undefined,
): string | null {
  if (!domain) {
    return null;
  }
  const pageId = KNOWN_ADVERTISER_PAGE_IDS[domain.trim().toLowerCase()];
  return normalizeNumericPageId(pageId);
}
