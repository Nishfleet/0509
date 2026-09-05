import { adLongevityDays } from "~/lib/ad-display";
import { dedupeTickerBodies } from "~/lib/ticker-dedup";
import type { AdRecord } from "~/lib/types";

const TICKER_MAX_ITEMS = 6;

/**
 * The capture ticker — motion before a word is read. Built from the REAL
 * cached ads (each item is one ad actually in the cache, with its real source
 * tag), so it is decorative but never fabricated. Reuses the landing's
 * `ld-ticker*` marquee so the funnel feels like one product. The brand-level
 * "live" tag only appears while the capture is fresh enough for a live claim;
 * older captures tag the brand "on record".
 */
export function BrandTicker({
  ads,
  brandName,
  fresh,
  now = new Date(),
}: {
  ads: AdRecord[];
  brandName: string;
  fresh: boolean;
  now?: Date;
}) {
  // Build the full candidate set first, then dedup by body so the first
  // cycle never repeats the same headline (issue #1496). Slicing AFTER dedup
  // means the 6 visible slots are 6 distinct bodies when the wall has ≥6
  // distinct bodies — a wall with fewer distinct bodies renders an honestly
  // shorter strip rather than padding it with repeats.
  const items = dedupeTickerBodies(
    ads
      .filter((ad) => (ad.previewHeadline?.trim() || ad.hook?.trim()))
      .map((ad) => ({
        id: ad.metaAdId,
        time: tickerTime(ad, now, fresh),
        event: ad.previewHeadline?.trim() || ad.hook?.trim() || "",
        source: sourceLabel(ad.source),
      })),
    (item) => item.event,
  ).slice(0, TICKER_MAX_ITEMS);

  if (items.length === 0) return null;

  const run = (
    <span className="ld-ticker-run">
      <em>{`${brandName} · ${fresh ? "live" : "on record"}`}</em>
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

function tickerTime(ad: AdRecord, now: Date, fresh: boolean): string {
  const days = adLongevityDays(ad, now);
  if (days === null) return fresh ? "live" : "on record";
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
