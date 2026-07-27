import { StatusStrip, type StatusCell } from "~/components/evidence/status-strip";
import { LocalTime } from "~/components/local-time";
import { Pill } from "~/components/pill";
import {
  formatWatchBoardCaughtValue,
  formatWatchBoardNextCheck,
  formatWatchBoardQuietValue,
  resolveWatchBoardStripAction,
  type WatchBoardSummary,
} from "~/lib/watchlist-display";

/**
 * Watch-board status strip — brief §6.3.
 *
 * ONE ruled row directly under the page title, and the only place page-level
 * status renders on this surface: lifecycle stamp → the one number that
 * matters → last check → next check → a single Rank-3 action. A cell with no
 * value prints the honest inline value (§6.6), never a spinner and never a
 * card, which is what collapses the audit's seven scattered status boxes.
 */

export function WatchBoardStatus({
  summary,
  windowDays,
  sourceCanSchedule,
  nextScanLabel,
  trackingStatusLabel,
}: {
  summary: WatchBoardSummary;
  windowDays: number;
  sourceCanSchedule: boolean;
  nextScanLabel: string;
  trackingStatusLabel: string;
}) {
  const action = resolveWatchBoardStripAction({ sourceCanSchedule, trackingStatusLabel });
  const cells: StatusCell[] = [
    {
      key: "Tracking",
      value: (
        <>
          <Pill state={summary.stamp.pillState} variant="stamp">
            {summary.stamp.label}
          </Pill>{" "}
          {summary.watching} of {summary.competitors} watching
        </>
      ),
    },
    {
      key: `Caught · ${windowDays}d`,
      value: formatWatchBoardCaughtValue(summary, windowDays),
      missingLabel: formatWatchBoardQuietValue(summary, windowDays),
    },
    {
      key: "Last check",
      value: summary.lastCheckAt ? <LocalTime iso={summary.lastCheckAt} /> : null,
      missingLabel: "no completed check yet",
    },
    {
      key: "Next check",
      value: formatWatchBoardNextCheck({
        activeCompetitors: summary.watching,
        sourceCanSchedule,
        nextScanLabel,
      }),
      missingLabel:
        summary.watching === 0 ? "every competitor is paused" : "after source access is ready",
    },
  ];

  return <StatusStrip action={action} ariaLabel="Watch board status" cells={cells} />;
}
