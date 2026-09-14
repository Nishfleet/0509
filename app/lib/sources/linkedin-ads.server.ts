import type { AppEnv } from "~/lib/env.server";
import type { JsonRecord } from "~/lib/data/helpers.server";
import { isLinkedInAdsSourceKilled } from "~/lib/env.server";
import { reserveDecodoBudget } from "~/lib/decodo-budget.server";
import { recordLinkedInAdsCaptureAttempt } from "~/lib/sources/linkedin-ads/linkedin-ads-usage.server";
import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import {
  fetchAdsByAccountOwner,
  type LinkedInAdCard,
  type LinkedInAdsSnapshotPayload,
} from "~/lib/sources/linkedin-ads/linkedin-ad-library.server";
import { LinkedinAdsSection } from "~/components/sources/linkedin-ads";

/**
 * LinkedIn Ads (Ad Library) source adapter (#2193, replaces seam #2218 stub).
 *
 * Snapshots the LinkedIn Ad Library for a tracked competitor's account owner
 * via Decodo's universal target (standard pool, no JS rendering). Page 1 only
 * — the newest page suffices for change detection. The adapter calls the
 * Decodo budget helper BEFORE every request; on deny it returns unavailable
 * with reason "quota" so the snapshot is skipped without blocking the Meta
 * path. `cadence: "weekly"` — the seam's runner applies the gate.
 *
 * `diff()` returns SourceChange[]; the seam emits each through the existing
 * Meta alert path tagged with `sourceId: "linkedin"`. Three diff cases:
 * new ad ids (ad_new), ad ids gone (ad_inactive), copy changes on the same id
 * (landing_page_headline_changed — the ad's promoted text changed).
 *
 * #3196 posture: the LINKEDIN_ADS_SOURCE_DISABLED kill flag (unset or "0" =
 * the production posture; the flag only exists as an emergency brake) rides
 * requiresEnv, so the registry's env filter drops the source from scheduled
 * runs and the public /ads + /timeline sections omit when it flips. Every
 * Library READ (success or failure) is counted through the best-effort #2181
 * KV counters in linkedin-ads-usage.server.ts — the /status capture-failure
 * rate's denominator; the quota-deny below returns BEFORE any read and is
 * not counted. The #2873 capture-validity gate is preserved: an unavailable
 * read returns before any diff, so the previous good snapshot stays the diff
 * base — no phantom changes.
 */
export const linkedinAdsAdapter: SourceAdapter = {
  id: "linkedin",
  label: "LinkedIn Ads (Ad Library)",
  kind: "ads",
  implemented: true,
  cadence: "weekly",
  // Kill flag (issue #3196): LINKEDIN_ADS_SOURCE_DISABLED=1 pauses the source
  // (no runs, no /ads section); unset or "0" = on. The #2193 credential
  // requirement stays: without DECODO_SCRAPER_AUTH the source is off either
  // way.
  requiresEnv: (env: unknown): boolean =>
    !isLinkedInAdsSourceKilled(env as AppEnv) && Boolean((env as AppEnv).DECODO_SCRAPER_AUTH),

  async fetch(env: unknown, competitor: SourceFetchContext): Promise<SourceFetchResult> {
    const appEnv = env as AppEnv;

    // Budget check BEFORE the request (issue #2193 do:3). On deny, record
    // unavailable with reason "quota"; unavailable never blocks the Meta path.
    const budget = await reserveDecodoBudget(appEnv, "std");
    if (!budget.ok) {
      return { unavailable: true, reason: "quota" };
    }

    // Account owner = the tracked competitor's display name.
    const result = await fetchAdsByAccountOwner(appEnv, competitor.competitorLabel, {
      maxAds: 25,
    });

    // One counted attempt per Library READ — success or failure (issue
    // #3196). The #2193 quota-deny above returned before any read, so it is
    // not counted: the /status rate measures Library-read failures only.
    // Best-effort: the counter's own KV errors are swallowed inside it.
    await recordLinkedInAdsCaptureAttempt(appEnv, { failed: "unavailable" in result });

    // Plain `in` check on purpose: `"unavailable" in result && result.unavailable`
    // does not narrow the union in TypeScript 5.9, the negative branch keeps the
    // declared union and the payload reads below stop compiling.
    if ("unavailable" in result) {
      return result;
    }

    const payload: LinkedInAdsSnapshotPayload = {
      accountOwner: result.accountOwner,
      totalAds: result.totalAds,
      ambiguous: result.ambiguous,
      ads: result.ads,
    };

    return { payload: payload as unknown as JsonRecord };
  },

  diff(prev: SourceSnapshotRecord | null, next: SourceSnapshotInput): SourceChange[] {
    const changes: SourceChange[] = [];
    const nextAds = adsById(next.payload);
    const prevAds = prev ? adsById(prev.payload) : new Map<string, LinkedInAdCard>();

    // New ad ids.
    for (const [id, card] of nextAds) {
      if (!prevAds.has(id)) {
        changes.push({
          eventType: "ad_new",
          title: `New LinkedIn ad: ${truncate(card.text, 80)}`,
          summary: card.text,
          metadata: { adId: id, advertiser: card.advertiser, detailUrl: card.detailUrl },
        });
      }
    }

    // Ad ids gone (removed from the library).
    for (const [id, card] of prevAds) {
      if (!nextAds.has(id)) {
        changes.push({
          eventType: "ad_inactive",
          title: `LinkedIn ad removed: ${truncate(card.text, 80)}`,
          summary: card.text,
          metadata: { adId: id, advertiser: card.advertiser, detailUrl: card.detailUrl },
        });
      }
    }

    // Copy changes on the same id.
    for (const [id, nextCard] of nextAds) {
      const prevCard = prevAds.get(id);
      if (prevCard && prevCard.text !== nextCard.text) {
        changes.push({
          eventType: "landing_page_headline_changed",
          title: `LinkedIn ad copy changed: ${truncate(nextCard.text, 80)}`,
          summary: `Was: ${prevCard.text}\nNow: ${nextCard.text}`,
          metadata: { adId: id, advertiser: nextCard.advertiser, detailUrl: nextCard.detailUrl, before: prevCard.text, after: nextCard.text },
        });
      }
    }

    return changes;
  },

  Section: LinkedinAdsSection,
};

/** Pull the ads map out of a snapshot payload (prev or next). */
function adsById(payload: JsonRecord | undefined): Map<string, LinkedInAdCard> {
  const map = new Map<string, LinkedInAdCard>();
  const ads = payload?.ads;
  if (!Array.isArray(ads)) return map;
  for (const ad of ads) {
    if (ad && typeof ad === "object" && typeof (ad as LinkedInAdCard).id === "string") {
      map.set((ad as LinkedInAdCard).id, ad as LinkedInAdCard);
    }
  }
  return map;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
