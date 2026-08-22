/**
 * Capture-stamp labels for public proof surfaces.
 *
 * Meta Ad Library captures carry date-only clocks (`YYYY-MM-DD` — the
 * "Started running on <date>" scraper shape and the Meta API's
 * `ad_delivery_start_time` shape). Those strings must never be rendered
 * through a time-of-day formatter: `new Date("2026-08-01")` parses as UTC
 * midnight, so an hour/minute stamp would print the fake precision
 * "12:00 AM" for what is only a calendar date.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True when the value carries a calendar date and no time component. */
export function isDateOnlyIsoDate(value: string | null | undefined): boolean {
  return typeof value === "string" && DATE_ONLY_PATTERN.test(value.trim());
}

/**
 * Deterministic short date label ("Aug 1"). Pinned to UTC so a date-only
 * capture keeps its calendar day regardless of the formatting host.
 */
export function formatShortUtcDate(date: Date): string {
  return date.toLocaleString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Stamp label for a real capture clock: date-only inputs render their
 * calendar date ("Aug 1"), full timestamps render the capture clock
 * ("3:47 PM"). Returns null when the input is unusable — callers own the
 * fallback copy.
 */
export function formatCaptureStampLabel(iso: string | null | undefined): string | null {
  const trimmed = typeof iso === "string" ? iso.trim() : "";
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (isDateOnlyIsoDate(trimmed)) {
    return formatShortUtcDate(parsed);
  }
  return parsed.toLocaleString("en", {
    hour: "numeric",
    minute: "2-digit",
  });
}
