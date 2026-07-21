import { LocalTime } from "~/components/local-time";
import { Pill } from "~/components/pill";
import {
  formatRunEventTypes,
  formatRunStatusLabel,
  formatRunSummary,
  formatRunTriggerLabel,
  resolveWatchlistRunTiming,
} from "~/lib/watchlist-display";
import type { WatchlistRunRecord } from "~/lib/types";

export function RecentChecksSection({ runs }: { runs: WatchlistRunRecord[] }) {
  return (
    <section>
      <p className="f9-app-kicker">Recent checks</p>
      {runs.length === 0 ? (
        <p className="f9-muted-copy">No checks yet — the first one shows up here automatically.</p>
      ) : (
        <ul className="event-list f9-detail-split">
          {runs.map((run) => {
            const timing = resolveWatchlistRunTiming(run);
            return (
            <li className="f9-event-card" key={run.id}>
              <div className="f9-panel-toolbar">
                <div>
                  <p className="f9-app-kicker">
                    {formatRunStatusLabel(run.status, run.errorCode)} · {formatRunTriggerLabel(run.triggerType)}
                  </p>
                  <h3>
                    Started <LocalTime iso={run.startedAt} />
                  </h3>
                </div>
                <Pill>{run.pagesScanned} {run.pagesScanned === 1 ? "page" : "pages"}</Pill>
              </div>
              <p className="f9-muted-copy">
                {timing.timestamp ? (
                  <>
                    {timing.label} <LocalTime iso={timing.timestamp} />
                  </>
                ) : (
                  timing.label
                )}
                {run.baselineFromRunId ? ` · baseline ${run.baselineFromRunId.slice(0, 8)}` : ""}
              </p>
              {formatRunSummary(run.summary) ? (
                <p className="f9-muted-copy">{formatRunSummary(run.summary)}</p>
              ) : null}
              {formatRunEventTypes(run.summary) ? (
                <p className="f9-muted-copy">{formatRunEventTypes(run.summary)}</p>
              ) : null}
              {run.errorMessage ? <p>{run.errorMessage}</p> : null}
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
