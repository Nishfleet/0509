import { adLongevityDays } from "~/lib/ad-display";
import type { AdRecord } from "~/lib/types";

const TICKER_MAX_ITEMS = 6;

/**
 * The capture ticker — motion before a word is read. Built from the REAL
 * cached ads (each item is one ad actually in the cache, with its real source
 * tag), so it is decorative but never fabricated. Reuses the landing's
 * `ld-ticker*` marquee so the funnel feels like one product.
 */
export function BrandTicker({
  ads,
  brandName,
  now = new Date(),
}: {
  ads: AdRecord[];
  brandName: string;
  now?: Date;
}) {
  const items = ads
    .filter((ad) => (ad.previewHeadline?.trim() || ad.hook?.trim()))
    .slice(0, TICKER_MAX_ITEMS)
    .map((ad) => ({
      id: ad.metaAdId,
      time: tickerTime(ad, now),
      event: ad.previewHeadline?.trim() || ad.hook?.trim() || "",
      source: sourceLabel(ad.source),
    }));

  if (items.length === 0) return null;

  const run = (
    <span className="ld-ticker-run">
      <em>{`${brandName} · live`}</em>
      {items.map((item) => (
        <span className="ld-ticker-item" key={item.id}>
          <b>{item.time}</b> {item.event} <small>[{item.source}]</small>
        </span>
      ))}
    </span>
  );

  return (
    <div aria-hidden="true" className="ld-ticker f9-ads-ticker">
      <div className="ld-ticker-belt">
        {run}
        {run}
      </div>
    </div>
  );
}

function tickerTime(ad: AdRecord, now: Date): string {
  const days = adLongevityDays(ad, now);
  if (days === null) return "live";
  if (days < 1) return "new";
  if (days === 1) return "1d";
  return `${days}d`;
}

function sourceLabel(source: string): string {
  switch (source) {
    case "meta_library_browser":
    case "meta_api":
      return "ad library";
    default:
      return "ad library";
  }
}
