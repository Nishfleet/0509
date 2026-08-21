import type { ComponentProps } from "react";

import { RuledRow } from "~/components/workspace/ruled-list";
import { ResultQuickSave } from "~/components/result-quick-save";
import { formatAdLongevityLabel } from "~/lib/ad-display";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import { formatAdActiveStatus, formatResultCardSummary } from "~/lib/search-display";
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
  const running = ad.activeStatusObserved !== false && ad.active;
  const advertiser = formatAdvertiserLabel(ad.advertiser);
  const summary = formatResultCardSummary(ad);
  return (
    <RuledRow
      keyFocused={isKeyFocused}
      // Twenty results from one advertiser would otherwise be twenty links
      // called "Nykaa". The link is named for the ad it opens.
      linkLabel={`${advertiser} — ${summary}`}
      name={advertiser}
      say={summary}
      selected={isActive}
      status={formatAdActiveStatus(ad)}
      statusTone={running ? "on" : "quiet"}
      time={formatAdLongevityLabel(ad) ?? "—"}
      to={href}
      trail={
        canQuickSave ? (
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
