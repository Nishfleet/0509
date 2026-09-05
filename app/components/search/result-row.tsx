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
 * A likely row also gets a one-click "Yes, that's them" trail link that
 * opens the ad's detail pane, where the track/signup CTA lives — the
 * confirmation is one click, not a dead-end.
 */
export function SearchResultRow({
  ad,
  href,
  isActive,
  isKeyFocused,
  canQuickSave,
  collections,
  plan,
}: {
  ad: AdRecord;
  href: string;
  isActive: boolean;
  isKeyFocused: boolean;
  canQuickSave: boolean;
  collections: ResultQuickSaveProps["collections"];
  plan: ResultQuickSaveProps["plan"];
}) {
  const isDemo = ad.source === "demo";
  const running = ad.activeStatusObserved !== false && ad.active;
  const advertiser = formatAdvertiserLabel(ad.advertiser);
  const summary = formatResultCardSummary(ad);
  const tierLabel = formatResultTierLabel(ad);
  const tier = domainMatchTier(ad.domainMatch?.level);
  const say = ad.domainMatch ? (
    <>
      <TierBadge level={ad.domainMatch.level} />
      {summary}
    </>
  ) : (
    summary
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
          <Link className="f9-wk-lnk f9-wk-row-confirm" to={href}>
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
