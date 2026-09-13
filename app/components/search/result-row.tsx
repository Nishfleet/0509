import type { ComponentProps } from "react";
import { Link } from "react-router";

import { RuledRow } from "~/components/workspace/ruled-list";
import { ResultQuickSave } from "~/components/result-quick-save";
import { TierBadge } from "~/components/search/tier-badge";
import { formatAdLongevityLabel } from "~/lib/ad-display";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import {
  formatAdActiveStatus,
  formatResultCardSummary,
  formatResultTierLabel,
} from "~/lib/search-display";
import { domainMatchTier } from "~/lib/search-domain-match";
import type { AdRecord } from "~/lib/types";

type ResultQuickSaveProps = ComponentProps<typeof ResultQuickSave>;

/**
 * BL-031 — one search result, as a ruled row (concept v4).
 *
 * This replaced `SearchResultCard`, which was a bordered card carrying a
 * thumbnail, four pills, a summary, a domain-match line, an offer/destination/
 * language line and a format tag — nine elements repeated per result. The v4
 * list is a list: entity name, one plain sentence, one status word, one time,
 * one chevron. The creative, the angle, the offer, the destination and the
 * language all still exist; they moved into the detail pane, where the
 * creative is finally big enough to read.
 *
 * Demo-mode honesty is unchanged and is now stated in the row's own status
 * column: a demo-sourced result says the word "Sample" where a live result
 * says "Active". It was a boxed pill; a state is a word.
 *
 * BET 2 (issue 1482): every row that carries a `domainMatch.level` renders a
 * visible tier badge — "Verified" (green), "Likely" (amber), "Unmatched"
 * (grey) — the confidence marker a first-time visitor can read at a glance.
 * A likely row also gets a one-click "Yes, that's them" trail control. Since
 * issue 3306 (BET 2 finish line) that control DOES the confirm instead of
 * only opening the detail pane: when the visitor is signed out, `confirmTo`
 * is the signup intent (the Track-wall signup path for THIS ad, attribution
 * marker included), so the click starts signup with the confirmed brand
 * carried through; signed in, `confirmTo` is omitted and the trail keeps the
 * plain record href, whose selection reload records the confirmation through
 * the existing selection persistence — repeat clicks are idempotent.
 */
export function SearchResultRow({
  ad,
  href,
  isActive,
  isKeyFocused,
  canQuickSave,
  collections,
  plan,
  confirmTo,
}: {
  ad: AdRecord;
  href: string;
  isActive: boolean;
  isKeyFocused: boolean;
  canQuickSave: boolean;
  collections: ResultQuickSaveProps["collections"];
  plan: ResultQuickSaveProps["plan"];
  /**
   * Issue 3306: when the visitor is signed out, the Likely-confirm's signup
   * intent href (signupTrackingPath + allowlisted source marker). Omitted
   * when signed in — the trail then keeps the plain record href.
   */
  confirmTo?: string;
}) {
  const isDemo = ad.source === "demo";
  const running = ad.activeStatusObserved !== false && ad.active;
  const advertiser = formatAdvertiserLabel(ad.advertiser);
  const summary = formatResultCardSummary(ad);
  const tierLabel = formatResultTierLabel(ad);
  const tier = domainMatchTier(ad.domainMatch?.level);
  // Issue 2150 (re-scoped): the "N ads use this creative" count Meta already
  // publishes on Ad Library cards is parsed into `variantCount` but was never
  // labelled on the /search row. When a creative runs more than one version,
  // name it so a buyer can see the testing at a glance. Never rendered when
  // the count is missing or 1 — a bare "×1 versions" would be noise.
  const versionsLabel =
    ad.variantCount && ad.variantCount > 1 ? (
      <span className="f9-wk-versions">{`×${ad.variantCount} versions`}</span>
    ) : null;
  const say = ad.domainMatch ? (
    <>
      <TierBadge level={ad.domainMatch.level} />
      {summary}
      {versionsLabel}
    </>
  ) : (
    <>
      {summary}
      {versionsLabel}
    </>
  );
  return (
    <RuledRow
      keyFocused={isKeyFocused}
      // Twenty results from one advertiser would otherwise be twenty links
      // called "Nykaa". The link is named for the ad it opens. The tier word
      // widens the accessible name so "Likely — Allbirds" and "Unmatched —
      // Allbirds" are not read as identical links.
      linkLabel={`${tierLabel ? `${tierLabel} — ` : ""}${advertiser} — ${summary}`}
      name={advertiser}
      say={say}
      selected={isActive}
      status={isDemo ? "Sample" : formatAdActiveStatus(ad)}
      statusTone={isDemo ? "quiet" : running ? "on" : "quiet"}
      time={formatAdLongevityLabel(ad) ?? "—"}
      to={href}
      trail={
        tier === "likely" ? (
          <Link className="f9-wk-lnk f9-wk-row-confirm" to={confirmTo ?? href}>
            Yes, that&rsquo;s them
            <span aria-hidden="true" className="f9-wk-chev">
              &rsaquo;
            </span>
          </Link>
        ) : canQuickSave && !isDemo ? (
          <ResultQuickSave
            adId={ad.metaAdId}
            advertiser={ad.advertiser}
            collections={collections}
            plan={plan}
          />
        ) : undefined
      }
    />
  );
}
