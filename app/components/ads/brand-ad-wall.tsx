import { Link } from "react-router";

import { AdCreative } from "~/components/ads/ad-creative";
import { adLongevityDays, formatAdLongevityLabel, STRONG_LONGEVITY_DAYS } from "~/lib/ad-display";
import type { AdRecord } from "~/lib/types";

const WALL_VISIBLE_ADS = 5;
const NEW_AD_HOURS = 48;

/**
 * "All N ads, on the wall" — the grid of real creatives, ordered
 * longest-running → newest so proven runners land first. When the cache holds
 * more ads than fit, the final tile is an honest "+N more ads live" (or
 * "+N more ads on record" when the capture is no longer fresh enough for a
 * live claim) conversion cell carrying the domain to signup.
 */
export function BrandAdWall({
  ads,
  totalCount,
  brandName,
  domain,
  fresh,
  signupPath,
  now = new Date(),
}: {
  ads: AdRecord[];
  totalCount: number;
  brandName: string;
  domain: string;
  fresh: boolean;
  signupPath: string;
  now?: Date;
}) {
  const ordered = [...ads].sort((a, b) => (adLongevityDays(b, now) ?? 0) - (adLongevityDays(a, now) ?? 0));
  const visible = ordered.slice(0, WALL_VISIBLE_ADS);
  const remaining = Math.max(0, totalCount - visible.length);

  return (
    <div className="f9-ads-wall">
      {visible.map((ad) => (
        <BrandAdCard ad={ad} brandName={brandName} key={ad.metaAdId} now={now} />
      ))}
      {remaining > 0 ? (
        <article className="f9-ads-card f9-ads-card-more">
          <Link to={signupPath}>
            <span className="f9-ads-more-num">{`+${remaining}`}</span>
            <span className="f9-ads-more-label">
              {fresh ? "more ads live" : "more ads on record"}
            </span>
            <span className="f9-ads-more-cta">{`Watch ${domain} →`}</span>
          </Link>
        </article>
      ) : null}
    </div>
  );
}

function BrandAdCard({ ad, brandName, now }: { ad: AdRecord; brandName: string; now: Date }) {
  const longevityDays = adLongevityDays(ad, now);
  const longevityLabel = formatAdLongevityLabel(ad, now);
  const strong = longevityDays !== null && longevityDays >= STRONG_LONGEVITY_DAYS;
  const isNew = isNewlySeen(ad, now);
  const savedLabel = isNew ? "New" : "Screenshot saved";
  const destination = destinationDomain(ad.landingPageUrl);
  const advertiser = ad.advertiser?.trim() || brandName;
  const headline = ad.previewHeadline?.trim() || ad.hook?.trim() || advertiser;
  const hook = secondaryLine(ad);

  return (
    <article className="f9-ads-card">
      <AdCreative ad={ad} savedLabel={savedLabel} />
      <div className="f9-ads-card-body">
        <span className="f9-ads-card-adv">
          <span aria-hidden="true" className="f9-ads-card-sw" />
          {destination ? `${advertiser} · ${destination}` : advertiser}
        </span>
        <h3 className="f9-ads-card-headline">{headline}</h3>
        {hook ? <p className="f9-ads-card-hook">{hook}</p> : null}
        <div className="f9-ads-card-pills">
          {longevityLabel && ad.activeStatusObserved !== false ? (
            <span className={`f9-ads-pill${strong ? " f9-ads-pill-strong" : ""}`}>
              {longevityLabel}
            </span>
          ) : null}
          {ad.variantCount && ad.variantCount > 1 ? (
            <span className="f9-ads-pill">{`×${ad.variantCount} variants`}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function isNewlySeen(ad: AdRecord, now: Date): boolean {
  if (!ad.firstSeenAt) return false;
  const firstSeen = Date.parse(ad.firstSeenAt);
  if (Number.isNaN(firstSeen)) return false;
  return now.getTime() - firstSeen <= NEW_AD_HOURS * 60 * 60 * 1000;
}

function secondaryLine(ad: AdRecord): string | null {
  const cta = ad.cta?.trim();
  const hook = ad.hook?.trim();
  if (cta && hook && hook !== ad.previewHeadline?.trim()) {
    return `${cta} · ${hook}`;
  }
  if (hook && hook !== ad.previewHeadline?.trim()) {
    return hook;
  }
  return cta || null;
}

function destinationDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}
