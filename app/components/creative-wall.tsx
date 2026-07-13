import { AdLongevityPill } from "~/components/ad-longevity-pill";
import { AdThumb } from "~/components/ad-thumb";
import { adLongevityDays } from "~/lib/ad-display";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import {
  formatTrackedDaysLabel,
  trackedDaysBetween,
  type CreativeWallItem,
} from "~/lib/trend-chart-data";

/**
 * Creative wall: every ad the latest succeeded scan saw for this watchlist,
 * as a compact tile grid. Longevity provenance stays split — a green
 * "Running N days" pill means Meta published the start date; a gray
 * "Tracked N days" pill means we only know our own observation window.
 */
export function CreativeWall({ items, plan }: { items: CreativeWallItem[]; plan: string }) {
  return (
    <section aria-label="Creative wall">
      <div className="f9-panel-toolbar">
        <div>
          <p className="f9-app-kicker">Creative wall</p>
          <h3 style={{ marginTop: 0 }}>What they&rsquo;re running</h3>
        </div>
        {items.length > 0 ? (
          <span className="f9-status-pill">
            {items.length} creative{items.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="f9-muted-copy">
          No creatives captured yet — the wall fills in after the first successful scan.
          {plan === "free"
            ? " The free plan takes one snapshot when a watchlist is created; paid plans check every 3 hours."
            : ""}
        </p>
      ) : (
        <ul className="f9-creative-wall">
          {items.map((item) => (
            <li
              className={`f9-creative-tile${item.isActive ? "" : " is-inactive"}`}
              key={item.ad.metaAdId}
            >
              <AdThumb ad={item.ad} />
              <div className="f9-creative-tile-meta">
                <p className="f9-creative-tile-advertiser">
                  {formatAdvertiserLabel(item.ad.advertiser)}
                </p>
                {item.ad.cta?.trim() ? (
                  <p className="f9-creative-tile-cta">{item.ad.cta}</p>
                ) : null}
                <div className="f9-creative-tile-pills">
                  <CreativeTilePill item={item} />
                  {!item.isActive ? (
                    <span className="f9-creative-tile-status">Inactive</span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CreativeTilePill({ item }: { item: CreativeWallItem }) {
  // Meta-published start date wins; otherwise fall back to our own window.
  if (adLongevityDays(item.ad) !== null) {
    return <AdLongevityPill ad={item.ad} />;
  }

  const trackedDays = trackedDaysBetween(item.firstTrackedAt, item.lastTrackedAt);
  if (trackedDays === null) {
    return null;
  }

  return (
    <span className="f9-longevity-pill is-tracked">{formatTrackedDaysLabel(trackedDays)}</span>
  );
}
