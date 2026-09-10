import type { SourceSnapshotRecord, SourceChange } from "~/lib/sources/types";

/**
 * LinkedIn Ads (Ad Library) source section (#2193, replaces seam #2218 stub).
 *
 * Renders the latest snapshot inside its own Section: advertiser, total ads in
 * the library, new ads since the last check, up to 12 creative previews and
 * links to the public detail pages. Same shape as the TikTok section (#2194):
 * payload type guard, existing f9 classes, zero-ad state rendered rather than
 * hidden.
 *
 * Client-safe: imports only types, no `.server.ts` modules.
 */
interface LinkedinAdView {
  id: string;
  advertiser: string;
  text: string;
  creativeImageUrl: string | null;
  detailUrl: string;
}

interface LinkedinPayloadView {
  accountOwner: string;
  totalAds: number;
  ambiguous: boolean;
  ads: LinkedinAdView[];
}

function isLinkedinPayload(payload: unknown): payload is LinkedinPayloadView {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.accountOwner === "string" &&
    typeof p.totalAds === "number" &&
    Array.isArray(p.ads)
  );
}

/**
 * Only https creatives render. The card's first `<img>` can be a logo or a
 * non-https pixel, and a stored payload is not trusted markup.
 */
function creativeUrl(ad: LinkedinAdView): string | null {
  return typeof ad.creativeImageUrl === "string" && ad.creativeImageUrl.startsWith("https://")
    ? ad.creativeImageUrl
    : null;
}

/** Drop entries a stored payload cannot render (no id / no detail link). */
function renderableAds(ads: LinkedinAdView[]): LinkedinAdView[] {
  return ads.filter(
    (ad) =>
      Boolean(ad) &&
      typeof ad.id === "string" &&
      typeof ad.detailUrl === "string" &&
      ad.detailUrl.length > 0,
  );
}

export function LinkedinAdsSection({
  snapshot,
  diff,
}: {
  snapshot: SourceSnapshotRecord | null;
  diff: SourceChange[];
}) {
  if (!snapshot) return null;
  if (!isLinkedinPayload(snapshot.payload)) return null;

  const { accountOwner, totalAds, ambiguous } = snapshot.payload;
  const ads = renderableAds(snapshot.payload.ads);
  const newCount = diff.filter((c) => c.eventType === "ad_new").length;
  const previews = ads.slice(0, 12);

  return (
    <section aria-label="LinkedIn ads (Ad Library)">
      <p className="f9-evidence-micro">LinkedIn Ad Library</p>
      <p className="f9-wk-dim">
        Advertiser: <strong>{accountOwner}</strong> · Total ads in the library: {totalAds}
        {ambiguous ? " (some results filtered to exact advertiser name)" : null}
        {newCount > 0 ? ` · ${newCount} new since last check` : null}
      </p>
      {previews.length === 0 ? (
        <p className="f9-wk-dim">No LinkedIn ads found for {accountOwner}.</p>
      ) : (
        <div className="f9-ads-wall">
          {previews.map((ad) => {
            const creative = creativeUrl(ad);
            return (
              <article key={ad.id} className="f9-ads-card">
                {creative ? (
                  <div className="f9-ads-thumb">
                    <img
                      className="f9-ads-thumb-img"
                      src={creative}
                      alt={`${accountOwner} LinkedIn ad creative`}
                      loading="lazy"
                    />
                  </div>
                ) : null}
                <div className="f9-ads-card-body">
                  <span className="f9-ads-card-adv">
                    <span aria-hidden="true" className="f9-ads-card-sw" />
                    {ad.advertiser}
                  </span>
                  <p className="f9-ads-card-hook">{ad.text}</p>
                  <p>
                    <a
                      className="f9-wk-lnk"
                      href={ad.detailUrl}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                    >
                      View ad details
                    </a>
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="f9-wk-dim">
        LinkedIn's Ad Library does not expose spend; counts cover the ads the
        library shows for this advertiser.
      </p>
    </section>
  );
}
