import { useState } from "react";

import type { AdRecord } from "~/lib/types";

type AdThumbAd = Pick<AdRecord, "advertiser" | "format"> & {
  creativeImageUrl?: string | null;
};

// Renders the captured ad creative when we genuinely have one, otherwise a
// plainly-labeled muted box with the ad format. Never a fake placeholder
// pretending to be the creative, never a broken-image icon (creative CDN URLs
// can expire, so load failures fall back too).
export function AdThumb({ ad }: { ad: AdThumbAd }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = ad.creativeImageUrl?.trim() || null;
  const creativeKind = formatCreativeKind(ad.format);

  if (!imageUrl || imageFailed) {
    return (
      <span
        aria-label={`${creativeKind} ad creative preview unavailable`}
        className="f9-ad-thumb f9-ad-thumb-fallback"
        role="img"
      >
        <span aria-hidden="true">{creativeKind}</span>
      </span>
    );
  }

  return (
    <img
      alt={`Ad creative from ${ad.advertiser?.trim() || "this advertiser"}`}
      className="f9-ad-thumb"
      loading="lazy"
      onError={() => setImageFailed(true)}
      referrerPolicy="no-referrer"
      src={imageUrl}
    />
  );
}

function formatCreativeKind(format: string | null | undefined) {
  const normalized = format?.trim();
  if (!normalized) return "Ad";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}
