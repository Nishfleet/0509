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
  now,
}: {
  ad: Pick<AdRecord, "firstSeenAt" | "lastSeenAt" | "activeStatusObserved">;
  /**
   * The reference "now" the running-days count is measured against. Defaults
   * to the current wall-clock time; brand-page ad walls pass the capture's
   * fetched_at so "Running N days" is measured up to when the capture was
   * taken, not the moment the page is viewed (issue #2142).
   */
  now?: Date;
}) {
  if (ad.activeStatusObserved === false) return null;
  const days = adLongevityDays(ad, now);
  const label = formatAdLongevityLabel(ad, now);
  if (days === null || label === null) return null;

  return (
    <Pill variant="longevity" state={days >= STRONG_LONGEVITY_DAYS ? "strong" : undefined}>
      {label}
    </Pill>
  );
}
