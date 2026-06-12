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

  if (!imageUrl || imageFailed) {
    return <span className="f9-ad-thumb f9-ad-thumb-fallback">{ad.format}</span>;
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
