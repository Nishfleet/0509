import { Pill } from "~/components/pill";
import { adLongevityDays, formatAdLongevityLabel, STRONG_LONGEVITY_DAYS } from "~/lib/ad-display";
import type { AdRecord } from "~/lib/types";

/**
 * Small "Running N days" badge shown next to an ad's advertiser header.
 * Renders nothing when first-seen proof is unavailable (honest: no badge
 * when we do not know how long the ad has been running).
 */
export function AdLongevityPill({
  ad,
}: {
  ad: Pick<AdRecord, "firstSeenAt" | "lastSeenAt" | "activeStatusObserved">;
}) {
  if (ad.activeStatusObserved === false) return null;
  const days = adLongevityDays(ad);
  const label = formatAdLongevityLabel(ad);
  if (days === null || label === null) return null;

  return (
    <Pill variant="longevity" state={days >= STRONG_LONGEVITY_DAYS ? "strong" : undefined}>
      {label}
    </Pill>
  );
}
