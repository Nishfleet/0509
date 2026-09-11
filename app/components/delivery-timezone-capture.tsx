import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

/**
 * The card that used to collect a timezone is gone (#2416), so the browser is
 * the only place that knows it. Posts once on first app load, and only when the
 * account has no timezone yet.
 *
 * The server action is the real gate — it returns early when a timezone is
 * already stored — so a stale render cannot overwrite one; the `sent` ref only
 * stops this mount posting twice.
 *
 * Renders nothing, and shows nothing on failure: the fallback is UTC, which is
 * a correct zone, just not the user's.
 */
export function DeliveryTimezoneCapture({ needsTimezone }: { needsTimezone: boolean }) {
  const fetcher = useFetcher();
  const sent = useRef(false);

  useEffect(() => {
    if (!needsTimezone || sent.current) {
      return;
    }
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) {
      return;
    }
    sent.current = true;
    const formData = new FormData();
    formData.set("intent", "capture-delivery-timezone");
    formData.set("timezone", timezone);
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, needsTimezone]);

  return null;
}
