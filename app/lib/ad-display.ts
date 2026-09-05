import { classifyAdAngle, type AngleClassification } from "~/lib/angle-classifier";
import type { AdRecord } from "~/lib/types";

const MS_PER_DAY = 86_400_000;

/** Ads running at least this long get the visually stronger badge. */
export const STRONG_LONGEVITY_DAYS = 30;

type AdLongevityInput = Pick<AdRecord, "firstSeenAt" | "lastSeenAt">;

/**
 * Number of full days an ad has been observed running, floored, with a
 * one-day minimum. Returns null when first-seen proof is missing or the
 * timestamps are unusable (unparseable, first-seen in the future, or a
 * last-seen earlier than first-seen) — no badge when we do not know.
 */
export function adLongevityDays(ad: AdLongevityInput, now: Date = new Date()): number | null {
  if (!ad.firstSeenAt) return null;

  const firstSeen = Date.parse(ad.firstSeenAt);
  if (Number.isNaN(firstSeen)) return null;
  if (firstSeen > now.getTime()) return null; // clock-skew guard

  const lastSeen = ad.lastSeenAt ? Date.parse(ad.lastSeenAt) : Number.NaN;
  const end = Number.isNaN(lastSeen) ? now.getTime() : lastSeen;
  if (end < firstSeen) return null;

  return Math.max(1, Math.floor((end - firstSeen) / MS_PER_DAY));
}

/**
 * Honest longevity badge copy: "Running N days" ("Running 1 day" floor),
 * or null when first-seen proof is unavailable.
 */
export function formatAdLongevityLabel(ad: AdLongevityInput, now: Date = new Date()): string | null {
  const days = adLongevityDays(ad, now);
  if (days === null) return null;
  return days === 1 ? "Running 1 day" : `Running ${days} days`;
}

/**
 * Deterministic per-ad capture-date formatter. Locale and timezone are
 * pinned (en-GB, UTC) so the server-rendered label equals the hydrated
 * client copy — the same SSR/client parity rule as the proof capture label
 * (see formatProofCaptureLabel in search-display.ts).
 */
const AD_CAPTURE_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

type AdCaptureDateInput = Pick<AdRecord, "firstSeenAt">;

/**
 * Per-ad capture-date pill: "Since 24 Oct 2025" from the ad's firstSeenAt —
 * the date this creative was first observed in the Ad Library. This is what
 * makes months-old seasonal creatives (Diwali/Navratri/Pay Day, …) visibly
 * dated on a brand-page ad wall instead of reading as current rotation.
 * Returns null when first-seen proof is missing, unparseable, or in the
 * future (clock-skew guard) — no date when we do not know.
 */
export function formatAdCaptureSinceLabel(
  ad: AdCaptureDateInput,
  now: Date = new Date(),
): string | null {
  if (!ad.firstSeenAt) return null;

  const firstSeen = Date.parse(ad.firstSeenAt);
  if (Number.isNaN(firstSeen)) return null;
  if (firstSeen > now.getTime()) return null;

  return `Since ${AD_CAPTURE_DATE_FORMATTER.format(new Date(firstSeen))}`;
}

type AdAngleInput = Pick<AdRecord, "hook" | "body" | "offer" | "cta">;

/**
 * Marketing-angle read for an ad, computed at display time from the ad's
 * copy fields (deterministic and cheap — never persisted). Returns null when
 * the classifier cannot make an honest call; render nothing in that case.
 */
export function classifyAdRecordAngle(ad: AdAngleInput): AngleClassification | null {
  const sample = [ad.hook, ad.body, ad.offer, ad.cta]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" \n ");
  return classifyAdAngle(sample);
}
