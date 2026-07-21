import type { ComponentProps } from "react";
import { Link } from "react-router";

import { AdAnglePill } from "~/components/ad-angle-pill";
import { AdLongevityPill } from "~/components/ad-longevity-pill";
import { AdThumb } from "~/components/ad-thumb";
import { Pill } from "~/components/pill";
import { ResultQuickSave } from "~/components/result-quick-save";
import { formatOfferDisplay } from "~/lib/analysis-display";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import { formatResultCardSummary } from "~/lib/search-display";
import type { AdRecord } from "~/lib/types";

type ResultQuickSaveProps = ComponentProps<typeof ResultQuickSave>;

/**
 * One competitor-ad card in the /search results list. Presentational: the
 * parent owns selection/focus state and href construction and passes them in.
 * Markup and classes are identical to the inlined version this replaced.
 */
export function SearchResultCard({
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
  return (
    <div
      className={`f9-result-card-wrap${isKeyFocused ? " is-key-focus" : ""}`}
    >
      <Link
        className={`f9-result-card ${isActive ? "is-active" : ""}`}
        to={href}
      >
        <AdThumb ad={ad} />
        <div className="f9-result-card-body">
          <div>
            <span>{formatAdvertiserLabel(ad.advertiser)}</span>
            <h3>{ad.previewHeadline}</h3>
            <div className="f9-result-card-pills">
              {ad.source === "demo" ? (
                <Pill variant="longevity" state="sample">
                  Sample
                </Pill>
              ) : null}
              <AdLongevityPill ad={ad} />
              {ad.variantCount && ad.variantCount > 1 ? (
                <Pill variant="longevity">{`×${ad.variantCount} variants`}</Pill>
              ) : null}
              <AdAnglePill ad={ad} />
            </div>
          </div>
          <p>{formatResultCardSummary(ad)}</p>
          {ad.domainMatch?.reason ? (
            <strong>{ad.domainMatch.reason}</strong>
          ) : null}
          <small>
            {formatOfferDisplay(ad.offer)} ·{" "}
            {ad.destinationType} · {ad.languageLabel}
          </small>
          <em>{ad.format}</em>
        </div>
      </Link>
      {canQuickSave && ad.source !== "demo" ? (
        <ResultQuickSave
          adId={ad.metaAdId}
          advertiser={ad.advertiser}
          collections={collections}
          plan={plan}
        />
      ) : null}
    </div>
  );
}
