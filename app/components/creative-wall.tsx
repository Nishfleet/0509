import { AdLongevityPill } from "~/components/ad-longevity-pill";
import { AdThumb } from "~/components/ad-thumb";
import { Pill } from "~/components/pill";
import { adLongevityDays } from "~/lib/ad-display";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import {
  formatTrackedDaysLabel,
  trackedDaysBetween,
  type CreativeWallItem,
} from "~/lib/trend-chart-data";

const CREATIVE_WALL_PREVIEW_LIMIT = 18;

/**
 * Creative wall: a bounded preview of the latest healthy scan's ads. The
 * full input remains available to sibling analytics; this component labels
 * the preview against that true total. Longevity provenance stays split — a green
 * "Running N days" pill means Meta published the start date; a gray
 * "Tracked N days" pill means we only know our own observation window.
 */
export function CreativeWall({ items, plan }: { items: CreativeWallItem[]; plan: string }) {
  const previewItems = items.slice(0, CREATIVE_WALL_PREVIEW_LIMIT);
  const isCapped = previewItems.length < items.length;

  return (
    <section aria-label="Creative wall">
      <div className="f9-panel-toolbar">
        <div>
          <p className="f9-evidence-micro">Creative wall</p>
          <h3 className="f9-wk-mt0">What they&rsquo;re running</h3>
        </div>
        {items.length > 0 ? (
          <Pill>
            {isCapped
              ? `Showing ${previewItems.length} of ${items.length} creatives`
              : `${items.length} creative${items.length === 1 ? "" : "s"}`}
          </Pill>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div className="f9-watchdetail-empty">
          <p className="f9-watchdetail-empty-title">No creatives captured yet</p>
          <p>
            {plan === "free"
              ? "The free plan takes one snapshot when a competitor is added; paid plans check every 3–6 hours. This fills in after the first successful scan."
              : "This fills in after the first successful scan. Every creative we capture stays attached to the check that proved it."}
          </p>
        </div>
      ) : (
        <ul className="f9-creative-wall">
          {previewItems.map((item) => (
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
  if (item.isActive && adLongevityDays(item.ad) !== null) {
    return <AdLongevityPill ad={item.ad} />;
  }

  const trackedDays = trackedDaysBetween(item.firstTrackedAt, item.lastTrackedAt);
  if (trackedDays === null) {
    return null;
  }

  return (
    <Pill variant="longevity" state="tracked">
      {formatTrackedDaysLabel(trackedDays)}
    </Pill>
  );
}
