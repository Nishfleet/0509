import { Link } from "react-router";

import { LocalTime } from "~/components/local-time";
import { formatNextScanLabel } from "~/lib/schedule-display";
import type { resolveWatchlistTrackingPresentation } from "~/lib/watchlist-display";

export function TrackingStatusCard(props: {
  data: {
    selectedWatchlist: { isActive: boolean };
    plan: string;
    effectiveDeliveryConfig: { timezone: string | null };
    showPresenceNav: boolean;
  };
  trackingPresentation: ReturnType<typeof resolveWatchlistTrackingPresentation>;
  discoveryStatus: { recovery?: string | null };
  sourceCanSchedule: boolean;
  renderedAt: Date;
}) {
  const { data, trackingPresentation, discoveryStatus, sourceCanSchedule, renderedAt } = props;
  return (
    <section className="f9-detail-cell">
      <p className="f9-app-kicker">Tracking status</p>
      <h3>{trackingPresentation.headline}</h3>
      <p className="f9-muted-copy">
        {trackingPresentation.summary}
      </p>
      <div className="f9-work-list is-compact">
        <div className="f9-work-row">
          <p className="f9-app-kicker">How ads are checked</p>
          <p className="f9-muted-copy">
            Five to Nine checks public ad signals and shows Recent results when live checks are delayed.
          </p>
        </div>
        <div className="f9-work-row">
          <p className="f9-app-kicker">Status</p>
          <p className="f9-muted-copy">
            {trackingPresentation.statusLabel}
          </p>
        </div>
        <div className="f9-work-row">
          <p className="f9-app-kicker">Last check</p>
          <p className="f9-muted-copy">
            {trackingPresentation.lastCheckedAt ? (
              <LocalTime iso={trackingPresentation.lastCheckedAt} />
            ) : (
              "No recent check yet"
            )}
          </p>
        </div>
        <div className="f9-work-row">
          <p className="f9-app-kicker">Next check</p>
          <p className="f9-muted-copy">
            {!data.selectedWatchlist.isActive
              ? "Paused"
              : data.plan === "free"
                ? "Activation only — no recurring schedule on Free"
                : sourceCanSchedule
                  ? formatNextScanLabel(data.plan, renderedAt, data.effectiveDeliveryConfig.timezone)
                  : "After source access is ready"}
          </p>
        </div>
      </div>
      {discoveryStatus.recovery ? (
        <p className="f9-muted-copy">{discoveryStatus.recovery}</p>
      ) : null}
      <Link className="f9-secondary-button" to="/app/source-access">
        Check source access
      </Link>
      {data.showPresenceNav ? (
        <>
          <h3>Website presence</h3>
          <p className="f9-muted-copy">
            Track public website, blog, and feed changes for this competitor in Presence — separate from ad
            watchlists.
          </p>
          <Link className="f9-secondary-button" to="/app/presence">
            Open Presence
          </Link>
        </>
      ) : null}
    </section>
  );
}
