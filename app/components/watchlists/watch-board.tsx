import { useEffect, useState, type ReactNode } from "react";
import { useRevalidator } from "react-router";

import type { CaptureDay } from "~/components/evidence/capture-strip";
import { CompetitorBand } from "~/components/watchlists/competitor-band";
import { createReportId } from "~/lib/report";
import type { WatchlistRecord, WatchlistRunRecord } from "~/lib/types";
import {
  resolveWatchlistListScanPresentation,
  type WatchBoardBandSummary,
} from "~/lib/watchlist-display";

/**
 * The watch board — brief §7 (section order) built from §6.1 bands.
 *
 * The board is the page: one full-width band per competitor, the ticker
 * above it, and the opened competitor's detail beneath. It carries no status
 * cards of its own — page-level status is the single strip (§6.3).
 */

export interface WatchBoardCaptureWindowView {
  endDate: string;
  windowDays: number;
  days: Record<string, readonly CaptureDay[]>;
  capturedChanges: Record<string, number>;
  /** Optional so a cached loader payload from before BL-006's remediation
   *  degrades to "no known failures" instead of crashing the board. */
  failedChecks?: Record<string, number>;
}

export interface WatchBoardProps {
  watchlists: readonly WatchlistRecord[];
  captureWindow: WatchBoardCaptureWindowView;
  plan: string;
  openWatchlistId: string | null;
  pendingWatchlistId: string | null;
  /** Runs are loaded for the opened competitor only. */
  openWatchlistRun: WatchlistRunRecord | null;
  selectable: boolean;
  selectedIds: readonly string[];
  selectionDisabled: boolean;
  onToggleSelect: (watchlistId: string) => void;
  canReport: boolean;
  renderPauseAction: (watchlist: WatchlistRecord) => ReactNode;
}

export function toWatchBoardBandSummaries(
  watchlists: readonly WatchlistRecord[],
  capturedChanges: Record<string, number>,
  failedChecks: Record<string, number> = {},
): WatchBoardBandSummary[] {
  return watchlists.map((watchlist) => ({
    id: watchlist.id,
    name: watchlist.name,
    isActive: watchlist.isActive,
    lastScannedAt: watchlist.lastScannedAt,
    capturedChanges: capturedChanges[watchlist.id] ?? 0,
    failedChecks: failedChecks[watchlist.id] ?? 0,
  }));
}

/** ~10 minutes of 30s polls — long enough for a first capture to land. */
const FIRST_CAPTURE_POLL_MS = 30_000;
const FIRST_CAPTURE_POLL_LIMIT = 20;

/**
 * WP-C2 Beat 3: the first capture is the retention-critical first-run moment,
 * so the board — not just the opened competitor — keeps refreshing itself
 * while any competitor is still waiting for its first check. Bounded, and it
 * stops the moment nothing is waiting.
 */
function useBoardFirstCapturePolling(awaiting: boolean) {
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

export function WatchBoard(props: WatchBoardProps) {
  useBoardFirstCapturePolling(
    props.watchlists.some((watchlist) => watchlist.isActive && !watchlist.lastScannedAt),
  );

  return (
    <div className="f9-ed-board">
      {props.watchlists.map((watchlist) => {
        const isOpen = props.openWatchlistId === watchlist.id;
        const scan = resolveWatchlistListScanPresentation({
          isActive: watchlist.isActive,
          lastScannedAt: watchlist.lastScannedAt,
          latestRun: isOpen ? props.openWatchlistRun : null,
          plan: props.plan,
        });
        const capturedChanges = props.captureWindow.capturedChanges[watchlist.id] ?? 0;

        return (
          <CompetitorBand
            capturedChanges={capturedChanges}
            failedChecks={props.captureWindow.failedChecks?.[watchlist.id] ?? 0}
            captureDays={props.captureWindow.days[watchlist.id] ?? []}
            captureEndDate={props.captureWindow.endDate}
            captureWindowDays={props.captureWindow.windowDays}
            createdAt={watchlist.createdAt}
            id={watchlist.id}
            isActive={watchlist.isActive}
            isOpen={isOpen}
            isPending={props.pendingWatchlistId === watchlist.id}
            key={watchlist.id}
            lastScannedAt={watchlist.lastScannedAt}
            name={watchlist.name}
            onToggleSelect={() => props.onToggleSelect(watchlist.id)}
            plan={props.plan}
            scanLabel={scan.label}
            scanTimestamp={scan.timestamp}
            secondaryAction={
              props.canReport && watchlist.lastScannedAt
                ? {
                    label: "Package for client",
                    to: `/app/reports/${createReportId("watchlist", watchlist.id)}`,
                  }
                : null
            }
            selectable={props.selectable}
            selected={props.selectedIds.includes(watchlist.id)}
            selectionDisabled={props.selectionDisabled}
            targetCountry={watchlist.targetCountry}
            targetLabel={watchlist.targetLabel}
            trackingRole={watchlist.trackingRole}
            tertiaryAction={props.renderPauseAction(watchlist)}
          />
        );
      })}
    </div>
  );
}
