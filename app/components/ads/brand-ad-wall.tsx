import { Link } from "react-router";

import { AdCreative } from "~/components/ads/ad-creative";
import {
  adLongevityDays,
  formatAdCaptureSinceLabel,
  formatAdLongevityLabel,
  STRONG_LONGEVITY_DAYS,
} from "~/lib/ad-display";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import type { AdRecord } from "~/lib/types";

const WALL_VISIBLE_ADS = 5;
const NEW_AD_HOURS = 48;

/**
 * "All N ads, on the wall" — the grid of real creatives, ordered
 * longest-running → newest so proven runners land first. When the cache holds
 * more ads than fit, the final tile is an honest "+N more ads live" (or
 * "+N more ads on record" when the capture is no longer fresh enough for a
 * live claim) conversion cell carrying the domain to signup.
 *
 * OWNERSHIP HONESTY: every card is attributed to the creative's REAL
 * advertiser as stored in the cache. A creative whose advertiser could not be
 * captured renders "Advertiser unconfirmed" — never the page's brand name —
 * because a domain-mode cache also holds other advertisers' ads, and claiming
 * the brand runs a creative we cannot attribute is exactly the lie the page
 * exists to avoid (see adIsBrandOwned in brand-page.server.ts).
 */
export function BrandAdWall({
  ads,
  totalCount,
  domain,
  fresh,
  signupPath,
  partnerCampaignAdIds = [],
  now = new Date(),
}: {
  ads: AdRecord[];
  totalCount: number;
  domain: string;
  fresh: boolean;
  signupPath: string;
  /**
   * metaAdIds of verified-linked creatives that are NOT the brand's own
   * (partner/creator/reseller campaigns under a different Meta Page ID). These
   * render a "via partner" pill so the buyer sees the disambiguation
   * (issue #1566).
   */
  partnerCampaignAdIds?: string[];
  now?: Date;
}) {
  const ordered = [...ads].sort((a, b) => {
    // Verified-link cards lead the wall (accept #2: "the verified set
    // renders first"); within each group keep the proven-runners-first
    // longevity ordering so the two rules never conflict.
    const aVerified = a.linkVerifiedDomain ? 1 : 0;
    const bVerified = b.linkVerifiedDomain ? 1 : 0;
    if (aVerified !== bVerified) return bVerified - aVerified;
    return (adLongevityDays(b, now) ?? 0) - (adLongevityDays(a, now) ?? 0);
  });
  const visible = ordered.slice(0, WALL_VISIBLE_ADS);
  const remaining = Math.max(0, totalCount - visible.length);
  const partnerSet = new Set(partnerCampaignAdIds);

  return (
    <div className="f9-ads-wall">
      {visible.map((ad) => (
        <BrandAdCard ad={ad} key={ad.metaAdId} now={now} isPartner={partnerSet.has(ad.metaAdId)} />
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

function BrandAdCard({ ad, now, isPartner }: { ad: AdRecord; now: Date; isPartner: boolean }) {
  const longevityDays = adLongevityDays(ad, now);
  const longevityLabel = formatAdLongevityLabel(ad, now);
  const strong = longevityDays !== null && longevityDays >= STRONG_LONGEVITY_DAYS;
  const isNew = isNewlySeen(ad, now);
  const savedLabel = isNew ? "New" : "Screenshot saved";
  // The per-ad capture date: when this creative was first observed. A
  // months-old seasonal creative (Diwali/Navratri/Pay Day, …) reads as
  // current rotation without it — the date is the card's honest age anchor.
  const captureSinceLabel = formatAdCaptureSinceLabel(ad, now);
  const destination = destinationDomain(ad.landingPageUrl);
  // The REAL advertiser, or the honest unconfirmed label — never the brand
  // this page is about. A blank advertiser means discovery could not confirm
  // who ran the ad, so branding it as the brand's own would be a guess.
  const advertiser = formatAdvertiserLabel(ad.advertiser);
  const headline = ad.previewHeadline?.trim() || ad.hook?.trim() || advertiser;
  const hook = secondaryLine(ad);

  return (
    <article className="f9-ads-card">
      <AdCreative ad={ad} savedLabel={savedLabel} />
      <div className="f9-ads-card-body">
        {ad.linkVerifiedDomain ? (
          <span
            className="f9-ads-pill f9-ads-verified-badge"
            data-verified-link={ad.linkVerifiedDomain}
          >
            <span aria-hidden="true">✓</span> Verified link
          </span>
        ) : null}
        <span className="f9-ads-card-adv">
          <span aria-hidden="true" className="f9-ads-card-sw" />
          {destination ? `${advertiser} · ${destination}` : advertiser}
        </span>
        <h3 className="f9-ads-card-headline">{headline}</h3>
        {hook ? <p className="f9-ads-card-hook">{hook}</p> : null}
        <div className="f9-ads-card-pills">
          {captureSinceLabel ? (
            <span className="f9-ads-pill">{captureSinceLabel}</span>
          ) : null}
          {longevityLabel && ad.activeStatusObserved !== false ? (
            <span className={`f9-ads-pill${strong ? " f9-ads-pill-strong" : ""}`}>
              {longevityLabel}
            </span>
          ) : null}
          {ad.variantCount && ad.variantCount > 1 ? (
            <span className="f9-ads-pill">{`×${ad.variantCount} variants`}</span>
          ) : null}
          {isPartner ? (
            <span className="f9-ads-pill f9-ads-pill-partner">via partner</span>
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
