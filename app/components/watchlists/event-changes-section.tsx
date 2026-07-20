import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import type { PublicDeliveryAttemptSummary } from "~/lib/delivery-attempt-public";
import {
  formatConfidenceBandLabel,
  formatDeliveryAttemptStatusLabel,
  formatImportanceBandLabel,
  formatWatchEventStatusLabel,
  formatWatchEventTypeLabel,
  formatWhyAlertedLabel,
} from "~/lib/landing-page-display";
import { formatNextScanLabel } from "~/lib/schedule-display";
import { resolveEmptyWatchlistEventCopy } from "~/lib/watchlist-display";
import type {
  ProofCaptureRecord,
  WatchEventRecord,
  WatchlistRunRecord,
} from "~/lib/types";

export function EventChangesSection(props: {
  data: {
    events: WatchEventRecord[];
    selectedWatchlist: { lastScannedAt: string | null };
    runs: WatchlistRunRecord[];
    plan: string;
    effectiveDeliveryConfig: { timezone: string | null };
    highlightedEventId: string | null;
  };
  sourceCanSchedule: boolean;
  renderedAt: Date;
  proofCapturesById: Map<string, ProofCaptureRecord>;
  lastAttemptByEventId: Map<string, PublicDeliveryAttemptSummary>;
}) {
  const { data, sourceCanSchedule, renderedAt, proofCapturesById, lastAttemptByEventId } = props;
  return (
    <section>
      <p className="f9-app-kicker">See what changed</p>
      {data.events.length === 0 ? (
        <p className="f9-muted-copy">
          {resolveEmptyWatchlistEventCopy({
            lastScannedAt: data.selectedWatchlist.lastScannedAt,
            latestRun: (data.runs[0] as WatchlistRunRecord | undefined) ?? null,
            nextScanLabel: sourceCanSchedule
              ? formatNextScanLabel(
                  data.plan,
                  renderedAt,
                  data.effectiveDeliveryConfig.timezone,
                )
              : null,
            plan: data.plan,
          })}
        </p>
      ) : (
        <ul className="event-list">
          {data.events.map((event) => {
            const proofCapture = event.proofCaptureId
              ? proofCapturesById.get(event.proofCaptureId) ?? null
              : null;
            const lastAttempt = lastAttemptByEventId.get(event.id) ?? null;
            const intelligence = buildChangeIntelligenceSummary(
              event,
              data.effectiveDeliveryConfig.timezone,
            );

            const isHighlighted = data.highlightedEventId === event.id;
            return (
              <li
                className={`f9-event-card${isHighlighted ? " is-highlighted" : ""}`}
                id={`event-${event.id}`}
                key={event.id}
                tabIndex={isHighlighted ? -1 : undefined}
              >
                <div className="f9-panel-toolbar">
                  <div>
                    <p className="f9-app-kicker">
                      {formatWatchEventTypeLabel(event.eventType)} · {formatWatchEventStatusLabel(event.status)}
                    </p>
                    <h3>{event.title}</h3>
                  </div>
                  <span className="f9-status-pill">{formatImportanceBandLabel(event.importanceScore)}</span>
                </div>
                <p>{event.summary}</p>
                <div className="f9-work-list is-compact" style={{ marginTop: "0.75rem" }}>
                  <div className="f9-work-row">
                    <p className="f9-app-kicker">Evidence summary</p>
                    <p className="f9-muted-copy">
                      {proofCapture
                        ? `${formatConfidenceBandLabel(proofCapture.fieldConfidence)} · ${intelligence.proofTrail}`
                        : intelligence.proofTrail}
                    </p>
                  </div>
                  <div className="f9-work-row">
                    <p className="f9-app-kicker">Why this alerted</p>
                    <p className="f9-muted-copy">
                      {formatWhyAlertedLabel({
                        eventType: event.eventType,
                        status: event.status,
                        metadata: event.metadata,
                      })}
                    </p>
                  </div>
                  <div className="f9-work-row">
                    <p className="f9-app-kicker">Next review</p>
                    <p className="f9-muted-copy">{intelligence.recommendedAction}</p>
                  </div>
                  <div className="f9-work-row">
                    <p className="f9-app-kicker">Last send state</p>
                    <p className="f9-muted-copy">
                      {lastAttempt
                        ? `${formatDeliveryAttemptStatusLabel(lastAttempt.status, lastAttempt.channel)} · ${
                            lastAttempt.targetValue
                          }`
                        : "No alert sent for this change yet."}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
