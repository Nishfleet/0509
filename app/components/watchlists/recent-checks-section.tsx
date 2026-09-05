import { Link } from "react-router";

import { LocalTime } from "~/components/local-time";
import { QuietLineList } from "~/components/evidence/quiet-line";
import { watchlistDetailTabHref } from "~/lib/watchlist-detail-tabs";
import {
  formatCaptureAttemptReasonLabel,
  type CaptureAttemptReasonCode,
} from "~/lib/capture-attempt-reason-code";
import type { WatchlistRunRecord } from "~/lib/types";

import { buildQuietCheckItems } from "./event-changes-section";

/**
 * Capture attempts for the latest run (issue #1289). Each row is one URL the
 * most recent check looked at, including failed and skipped captures with a
 * public reason code. A failed capture is never an alert, but it is always
 * visible here so the silence is provable.
 */
export type LatestRunCaptureAttempt = {
  id: string;
  status: "succeeded" | "capture_failed" | "skipped_due_to_budget";
  reasonCode: string | null;
  urlChecked: string | null;
  checkedAt: string;
};

export function RecentChecksSection({
  runs,
  watchlistId,
  checksExpanded = false,
  latestRunCaptureAttempts = [],
}: {
  runs: WatchlistRunRecord[];
  watchlistId: string;
  checksExpanded?: boolean;
  latestRunCaptureAttempts?: readonly LatestRunCaptureAttempt[];
}) {
  const items = buildQuietCheckItems(runs);
  const captureItems = buildCaptureAttemptItems(latestRunCaptureAttempts);

  return (
    <section aria-label="Recent checks">
      <p className="f9-evidence-micro">Recent checks</p>
      {items.length === 0 ? (
        <p className="f9-wk-dim">
          No checks yet — the first one shows up here automatically.
        </p>
      ) : (
        <QuietLineList
          expanded={checksExpanded}
          items={items}
          loadMore={{
            to: `${watchlistDetailTabHref(watchlistId, "evidence")}&checks=all`,
          }}
        />
      )}
      {captureItems.length > 0 ? (
        <section aria-label="What the latest check looked at" className="f9-wk-mt">
          <div className="f9-wk-sec-head">
            <p className="f9-evidence-micro">What the latest check looked at</p>
            {/* Issue #1476: the full run history is its own URL-addressable
                surface; the quiet line here is the doorway to it. */}
            <Link className="f9-wk-lnk" to={`/app/watchlists/${watchlistId}`}>
              Full run history
            </Link>
          </div>
          <QuietLineList expanded={checksExpanded} items={captureItems} />
          <p className="f9-wk-dim">
            Every URL the latest check touched is listed — including captures
            that did not produce an alert, with the reason. A failed capture is
            never an alert, but it is never hidden either.
          </p>
        </section>
      ) : null}
    </section>
  );
}

function buildCaptureAttemptItems(
  attempts: readonly LatestRunCaptureAttempt[],
) {
  return attempts.map((attempt) => ({
    id: attempt.id,
    stamp: <LocalTime iso={attempt.checkedAt} />,
    copy: formatCaptureAttemptCopy(attempt),
  }));
}

function formatCaptureAttemptCopy(
  attempt: LatestRunCaptureAttempt,
): string {
  const url = attempt.urlChecked?.trim();
  const where = url ? ` ${shortenUrl(url)}` : "";
  if (attempt.status === "succeeded") {
    return `Captured${where}.`;
  }
  const reason = formatCaptureAttemptReasonLabel(
    attempt.reasonCode as CaptureAttemptReasonCode | null,
  );
  // The human label only — the raw reason-code token stays out of the UI
  // (issue #1476; tokens remain in the /api/v1 response for compatibility).
  return `${reason}${where}. No alert sent.`;
}

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url.length > 60 ? `${url.slice(0, 57)}…` : url;
  }
}
