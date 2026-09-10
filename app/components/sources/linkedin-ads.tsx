import type { SourceSnapshotRecord, SourceChange } from "~/lib/sources/types";
import type { LinkedInAdCard } from "~/lib/sources/linkedin-ads/linkedin-ad-library.server";

/**
 * LinkedIn Ads (Ad Library) source section (#2193, replaces seam #2218 stub).
 *
 * Renders the latest LinkedIn Ad Library snapshot inside the competitor page's
 * presence-source section: advertiser, total ads, new ads since the last
 * check, up to 12 creative previews, and links to the public detail pages.
 * Renders nothing when there is no snapshot (the seam's slot passes null
 * until a snapshot is stored and loaded).
 */
export function LinkedinAdsSection({
  snapshot,
  diff,
}: {
  snapshot: SourceSnapshotRecord | null;
  diff: SourceChange[];
}) {
  if (!snapshot) return null;

  const payload = snapshot.payload as {
    accountOwner?: string;
    totalAds?: number;
    ambiguous?: boolean;
    ads?: LinkedInAdCard[];
  };
  const ads = Array.isArray(payload.ads) ? payload.ads : [];
  if (ads.length === 0) return null;

  const accountOwner = payload.accountOwner ?? "this advertiser";
  const totalAds = payload.totalAds ?? ads.length;
  const newCount = diff.filter((c) => c.eventType === "ad_new").length;
  const previews = ads.slice(0, 12);

  return (
    <section className="f9-linkedin-ads-section">
      <div className="f9-evidence-micro">LinkedIn Ad Library</div>
      <h3 className="f9-wk-mt0">{accountOwner} on LinkedIn Ads</h3>
      <p className="f9-linkedin-ads-summary">
        {totalAds} {totalAds === 1 ? "ad" : "ads"} in the library
        {payload.ambiguous ? " (some results filtered to exact advertiser name)" : null}
        {newCount > 0 ? ` · ${newCount} new since last check` : null}
      </p>
      <ul className="f9-linkedin-ads-list">
        {previews.map((ad) => (
          <li key={ad.id} className="f9-ads-card f9-linkedin-ads-card">
            {ad.creativeImageUrl ? (
              <img
                className="f9-linkedin-ads-creative"
                src={ad.creativeImageUrl}
                alt={`${accountOwner} LinkedIn ad creative`}
                loading="lazy"
              />
            ) : null}
            <div className="f9-ads-card-body">
              <span className="f9-ads-card-adv">{ad.advertiser}</span>
              <p className="f9-ads-card-hook">{ad.text}</p>
              <a
                className="f9-wk-lnk"
                href={ad.detailUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                View ad details
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
