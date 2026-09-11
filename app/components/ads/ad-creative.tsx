import { useState } from "react";

import {
  buildCreativeResourceUrl,
  isFbcdnCreativeUrl,
} from "~/lib/creative-edge-cache-url";
import type { AdRecord } from "~/lib/types";

type AdCreativeAd = Pick<
  AdRecord,
  "advertiser" | "format" | "previewHeadline" | "hook" | "creativeImageUrl"
> & {
  /**
   * Issue #2393: the ad id the `/creative/:id` edge route resolves. Optional —
   * the static example cards have no real ad behind them and fall back to the
   * honest mock.
   */
  metaAdId?: string | null;
};

/**
 * The creative rectangle for a wall card. The REAL captured creative image is
 * the primary path — hotlinked fbcdn captures are served same-origin through
 * the `/creative/:id` edge route (issue #2393) and never as a raw URL (issue
 * #2401); when neither is available we fall back to a rich, on-brand CSS mock
 * (format-tinted backdrop + the ad's real headline overlaid + a format chip)
 * so a card is NEVER a flat gray box or a broken-image icon. The mock is the
 * FALLBACK only — the honest default is always the brand's real ad.
 */
export function AdCreative({
  ad,
  savedLabel,
  loading = "lazy",
}: {
  ad: AdCreativeAd;
  savedLabel: string | null;
  /**
   * `loading` attr on the captured creative `<img>`. Defaults to `"lazy"` (the
   * `/ads/:domain` wall and example cards are below the fold). Callers that
   * place the thumbnail in the hero LCP area pass `"eager"` for the first card
   * so the largest paint is not deferred, with fixed dimensions reserved by
   * the `f9-ads-thumb` aspect-ratio box so eager/lazy never causes CLS.
   */
  loading?: "lazy" | "eager";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const storedUrl = ad.creativeImageUrl?.trim() || null;
  // Issue #2401: a raw fbcdn URL is never emitted — its `oe=` signature expires
  // in ~4 days, it hands Meta a referrer and it bypasses every cache we control.
  // Issue #2730: that gate covers EVERY fbcdn shape — apex host, http, and
  // scheme-relative included — not just the https subdomains the edge route
  // fetches. A stored fbcdn creative goes through the `/creative/:id` route or
  // renders the honest mock; any other host is left as stored: it has none of
  // those failure modes and the edge route is fbcdn-gated by design (no open
  // proxy).
  const src = isFbcdnCreativeUrl(storedUrl)
    ? buildCreativeResourceUrl(ad.metaAdId, storedUrl)
    : storedUrl;
  const format = normalizeFormat(ad.format);
  const showImage = Boolean(src) && !imageFailed;

  return (
    <span className="f9-ads-thumb" data-format={format}>
      {showImage && src ? (
        <img
          alt={`Ad creative from ${ad.advertiser?.trim() || "this advertiser"}`}
          className="f9-ads-thumb-img"
          loading={loading}
          onError={() => setImageFailed(true)}
          referrerPolicy="no-referrer"
          src={src}
        />
      ) : (
        <span aria-hidden="true" className="f9-ads-thumb-mock">
          <span className="f9-ads-thumb-mock-headline">{mockHeadline(ad)}</span>
          {format === "video" ? <span className="f9-ads-thumb-play" /> : null}
          {format === "carousel" ? (
            <span className="f9-ads-thumb-dots">
              <i />
              <i />
              <i />
            </span>
          ) : null}
        </span>
      )}
      <span className="f9-ads-thumb-fmt">{formatChipLabel(format)}</span>
      {/* Issue #2475 (M50 judge edit): the chip names a saved screenshot —
          once imageFailed has flipped the tile to the mock, the visible
          artifact is not a saved shot, so the chip goes too. Gate on
          imageFailed ONLY: a null src keeps caller-owned labels like the
          marketing example cards' "Example" badge. */}
      {!imageFailed && savedLabel ? (
        <span className="f9-ads-thumb-saved">{savedLabel}</span>
      ) : null}
    </span>
  );
}

function normalizeFormat(format: string | null | undefined): string {
  const normalized = format?.trim().toLowerCase();
  if (normalized === "video" || normalized === "carousel" || normalized === "image") {
    return normalized;
  }
  return "image";
}

function formatChipLabel(format: string): string {
  return `${format.charAt(0).toUpperCase()}${format.slice(1)}`;
}

function mockHeadline(ad: AdCreativeAd): string {
  const headline = ad.previewHeadline?.trim() || ad.hook?.trim();
  if (headline) return headline;
  return ad.advertiser?.trim() || "Ad creative";
}
