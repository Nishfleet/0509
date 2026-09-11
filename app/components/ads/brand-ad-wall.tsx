import { Link } from "react-router";

import { AdCreative } from "~/components/ads/ad-creative";
import { AdLongevityPill } from "~/components/ad-longevity-pill";
import {
  adLongevityDays,
  formatAdCaptureSinceLabel,
} from "~/lib/ad-display";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import type { AdRecord } from "~/lib/types";

export const WALL_VISIBLE_ADS = 5;
const NEW_AD_HOURS = 48;

/**
 * The fields one wall card reads. Mirrors the loader's `BrandPageAd`
 * projection (issue #2391): the hydration payload ships only those fields, so
 * typing the prop as this Pick keeps a newly added `ad.<field>` read here from
 * silently resolving to `undefined` in the browser. Any drift between the two
 * lists — a field dropped from the loader projection that this adds back, or a
 * field this reads that the loader stops shipping — fails to compile at the
 * `<BrandAdWall ads={data.ads} />` call site, which is where the two meet.
 */
type WallAd = Pick<
  AdRecord,
  | "metaAdId"
  | "advertiser"
  | "previewHeadline"
  | "hook"
  | "cta"
  | "format"
  | "landingPageUrl"
  | "firstSeenAt"
  | "lastSeenAt"
  | "activeStatusObserved"
  | "variantCount"
  | "creativeImageUrl"
  | "linkVerifiedDomain"
>;

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
  capturedAt = null,
}: {
  ads: WallAd[];
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
  /**
   * ISO timestamp of the underlying Ad Library capture (the capture's
   * fetched_at). When present, the "Running N days" count is measured up to
   * this capture time rather than the moment the page is viewed, so the badge
   * reflects how long the ad had been running when the data was collected
   * (issue #2142).
   */
  capturedAt?: string | null;
}) {
  // Verified-link cards lead the wall (accept #2: "the verified set
  // renders first"); within each group keep the proven-runners-first
  // longevity ordering so the two rules never conflict. The longevity key
  // is measured from the CAPTURE time (the issue #2142 basis, deterministic
  // across server render and hydration) — never wall-clock, which would let
  // two same-length creatives swap ranks between the server render and the
  // browser and break hydration (issue #2704; the loader selects the
  // shipped slice with this exact key).
  const sortKey = capturedAt ? new Date(capturedAt) : now;
  const ordered = [...ads].sort((a, b) => {
    const aVerified = a.linkVerifiedDomain ? 1 : 0;
    const bVerified = b.linkVerifiedDomain ? 1 : 0;
    if (aVerified !== bVerified) return bVerified - aVerified;
    return (adLongevityDays(b, sortKey) ?? 0) - (adLongevityDays(a, sortKey) ?? 0);
  });
  const visible = ordered.slice(0, WALL_VISIBLE_ADS);
  const remaining = Math.max(0, totalCount - visible.length);
  const partnerSet = new Set(partnerCampaignAdIds);
  const capturedAtDate = capturedAt ? new Date(capturedAt) : null;

  return (
    <div className="f9-ads-wall">
      {visible.map((ad) => (
        <BrandAdCard ad={ad} key={ad.metaAdId} now={now} capturedAt={capturedAtDate} isPartner={partnerSet.has(ad.metaAdId)} />
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

function BrandAdCard({ ad, now, capturedAt, isPartner }: { ad: WallAd; now: Date; capturedAt: Date | null; isPartner: boolean }) {
  const isNew = isNewlySeen(ad, now);
  // Issue #2475 (M50): the chip claims a saved snapshot exists — only say it
  // when a captured creative actually backs the card. A mock fallback tile is
  // not a screenshot.
  const savedLabel = isNew
    ? "New"
    : ad.creativeImageUrl?.trim()
      ? "Screenshot saved"
      : null;
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
          <AdLongevityPill ad={ad} now={capturedAt ?? now} />
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

function isNewlySeen(ad: WallAd, now: Date): boolean {
  if (!ad.firstSeenAt) return false;
  const firstSeen = Date.parse(ad.firstSeenAt);
  if (Number.isNaN(firstSeen)) return false;
  if (firstSeen > now.getTime()) return false; // clock-skew guard (issue #2475, M52)
  return now.getTime() - firstSeen <= NEW_AD_HOURS * 60 * 60 * 1000;
}

function secondaryLine(ad: WallAd): string | null {
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
