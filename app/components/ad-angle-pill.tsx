import { classifyAdRecordAngle } from "~/lib/ad-display";
import { ANGLE_DISPLAY, formatAngleTooltip } from "~/lib/angle-display";
import type { AdRecord } from "~/lib/types";

/**
 * Small marketing-angle badge shown next to the longevity/variant pills.
 * Renders nothing when the classifier cannot make an honest call (no
 * "unknown" chips). brand_lifestyle is a lower-confidence fallback read and
 * gets the visually quieter treatment.
 */
export function AdAnglePill({ ad }: { ad: Pick<AdRecord, "hook" | "body" | "offer" | "cta"> }) {
  const classification = classifyAdRecordAngle(ad);
  if (!classification) return null;

  return (
    <span
      className={`f9-longevity-pill f9-angle-pill${classification.lowConfidence ? " is-tentative" : ""}`}
      title={formatAngleTooltip(classification)}
    >
      {ANGLE_DISPLAY[classification.angle].label}
    </span>
  );
}
