import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

/** ~10 minutes of 30s polls — long enough for a first capture to land. */
const FIRST_CAPTURE_POLL_MS = 30_000;
const FIRST_CAPTURE_POLL_LIMIT = 20;

/**
 * WP-C2 Beat 3, carried into BL-030: the first capture is the
 * retention-critical first-run moment, so the whole Competitors list — not
 * just the opened competitor — keeps refreshing itself while any competitor
 * is still waiting for its first check. Bounded, and it stops the moment
 * nothing is waiting. Extracted verbatim from the deleted watch board so the
 * behaviour survives the rebuild.
 */
export function useFirstCapturePolling(awaiting: boolean) {
  const revalidator = useRevalidator();
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    setPolls(0);
  }, [awaiting]);

  useEffect(() => {
    if (!awaiting || polls >= FIRST_CAPTURE_POLL_LIMIT) {
      return;
    }
    const timer = setTimeout(() => {
      setPolls((count) => count + 1);
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, FIRST_CAPTURE_POLL_MS);
    return () => clearTimeout(timer);
  }, [awaiting, polls, revalidator]);
}
