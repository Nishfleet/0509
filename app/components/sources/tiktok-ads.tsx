import type { SourceSnapshotRecord, SourceChange } from "~/lib/sources/types";

/**
 * TikTok Ads (Commercial Content Library) source section (#2194). Renders the
 * latest snapshot: legal advertiser name, total EU-shown ads, and the newest
 * 12 ads with dates and external detail links. Returns null when there is no
 * snapshot (the seam does not pass snapshots to SourceSections yet; #2188
 * wires that).
 *
 * Client-safe: imports only types, no `.server.ts` modules.
 */
interface TiktokAdView {
  adId: string;
  advertiser: string;
  firstShown: string;
  lastShown: string;
  uniqueUsers: string;
  thumbnail: string | null;
}

interface TiktokPayloadView {
  ads: TiktokAdView[];
  totalAds: number;
  legalName: string;
}

function isTiktokPayload(payload: unknown): payload is TiktokPayloadView {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return Array.isArray(p.ads) && typeof p.totalAds === "number" && typeof p.legalName === "string";
}

export function TiktokAdsSection({
  snapshot,
  diff: _diff,
}: {
  snapshot: SourceSnapshotRecord | null;
  diff: SourceChange[];
}) {
  if (!snapshot) return null;
  const payload = snapshot.payload;
  if (!isTiktokPayload(payload)) return null;

  const ads = payload.ads;
  const totalAds = payload.totalAds;
  const legalName = payload.legalName;

  return (
    <section aria-label="TikTok ads (EU-shown)">
      <p className="f9-evidence-micro">TikTok ads — EU-shown only</p>
      <p className="f9-wk-dim">
        Advertiser: <strong>{legalName}</strong> · Total EU-shown ads: {totalAds}
      </p>
      {ads.length === 0 ? (
        <p className="f9-wk-dim">
          No EU-shown TikTok ads found for {legalName}.
        </p>
      ) : (
        <ul className="f9-detail-split f9-wk-mt">
          {ads.map((ad) => (
            <li key={ad.adId} className="f9-detail-cell">
              <p>
                <a
                  className="f9-wk-lnk"
                  href={`https://library.tiktok.com/ads/detail/?ad_id=${ad.adId}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  View ad
                </a>
              </p>
              <p className="f9-wk-dim">
                {ad.advertiser}
              </p>
              <p className="f9-wk-dim">
                First shown: {ad.firstShown} · Last shown: {ad.lastShown}
              </p>
              <p className="f9-wk-dim">
                Unique users seen: {ad.uniqueUsers}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="f9-wk-dim">
        EU-shown ads only. TikTok's Commercial Content Library does not expose
        spend or impressions; counts reflect EU-shown ads in the lookback window.
      </p>
    </section>
  );
}
