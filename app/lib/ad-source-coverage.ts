/**
 * Public, honest coverage notes for every tracked ad source (issue #2992).
 *
 * ONE shared constant, rendered by /pricing (PricingSection), /docs (the
 * "Where the ads come from" block), and the /pricing markdown body — the
 * issue's rule: "Copy must state per source what is covered (region, ad
 * types) and what is not; the legal memo on this issue is the source of
 * those statements." Every statement here traces to the sourced research
 * memo pinned on Nishfleet/0509#2992 (00 Inbox/agent-drop/pi/vps/
 * 2026-09-12-meta-single-source-research.md) and to what the adapters
 * actually capture; nothing aspirational.
 *
 * Client-safe: pure data, zero imports — the same house pattern as
 * CAPTURE_VALIDITY_PUBLIC_RULES (capture-validity-public-rules.ts), so the
 * rendered pages and the AI-engine markdown body cannot drift. A test
 * (tests/ad-source-coverage.test.ts) pins these ids and their plan gating
 * against the authoritative plan-entitlements catalog.
 */

export type AdSourceCoverageId = "meta" | "google_ads" | "linkedin" | "tiktok";

export interface AdSourceCoverageEntry {
  /** The seam's source id (app/lib/sources/types.ts SOURCE_IDS). */
  id: AdSourceCoverageId;
  /** How the public pages already name this source. */
  label: string;
  /** What the source covers: region and ad types, stated plainly. */
  covers: string;
  /** What the source does not cover, stated equally plainly. */
  notCovered: string;
  /** "all" = every plan sees it (Free included); "paid" = paid plans only. */
  plans: "all" | "paid";
}

export const AD_SOURCE_COVERAGE: readonly AdSourceCoverageEntry[] = [
  {
    id: "meta",
    label: "Meta Ad Library",
    covers:
      "Publicly listed Facebook and Instagram ads, as the Ad Library lists them, country by country.",
    notCovered:
      "Spend, impressions, and demographics are not published by the Ad Library, and the official Ad Library API only returns commercial ads that reached the EU/UK — so the service reads the public library instead.",
    plans: "all",
  },
  {
    id: "google_ads",
    label: "Google Ads (Transparency Center)",
    covers:
      "Creatives the public Google Ads Transparency Center lists for the tracked domain — the same listings anyone can look up there, read in order (newest 200 kept).",
    notCovered:
      "Spend, impressions, and targeting detail: the Transparency Center search does not return them, so they are never shown.",
    plans: "paid",
  },
  {
    id: "linkedin",
    label: "LinkedIn (Ad Library)",
    covers:
      "Publicly listed promoted posts from the LinkedIn Ad Library's United States listings: the advertiser, the promoted text, and a link to the public detail page.",
    notCovered:
      "United States listings only — other countries' listings, spend, and impressions are not captured.",
    plans: "paid",
  },
  {
    id: "tiktok",
    label: "TikTok (Commercial Content Library, EU-shown)",
    covers:
      "EU-shown ads from the public TikTok Commercial Content Library: the advertiser, first- and last-shown dates, and unique-user counts, newest dozen.",
    notCovered:
      "EU-shown ads only — other regions' ads are not listed, and TikTok does not expose spend or impressions.",
    plans: "paid",
  },
] as const;

/**
 * The honesty line every surface renders beneath the per-source notes: a
 * source's own section states its coverage, and a source that could not be
 * checked says so rather than silently disappearing or pretending.
 */
export const AD_SOURCE_COVERAGE_HONESTY_LINE =
  "Each source appears on a brand page only when it captured something, its own section states what it covers, and when a source cannot be checked its section says so. Coverage limits above come from what each public ad library itself publishes.";

/** The sources a Free plan watches (derived; the test pins this to plan-entitlements). */
export function freePlanCoverageSources(): readonly AdSourceCoverageEntry[] {
  return AD_SOURCE_COVERAGE.filter((entry) => entry.plans === "all");
}

/** The sources only paid plans watch (derived; the test pins this to plan-entitlements). */
export function paidPlanCoverageSources(): readonly AdSourceCoverageEntry[] {
  return AD_SOURCE_COVERAGE.filter((entry) => entry.plans === "paid");
}
