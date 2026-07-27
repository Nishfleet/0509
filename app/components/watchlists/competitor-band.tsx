import type { ReactNode } from "react";
import { Link } from "react-router";

import { CaptureStrip, type CaptureDay } from "~/components/evidence/capture-strip";
import { SecondaryAction } from "~/components/evidence/cta";
import { LocalTime } from "~/components/local-time";
import { Pill } from "~/components/pill";
import type { WatchlistTrackingRole } from "~/lib/types";
import {
  formatWatchBandCadence,
  formatWatchBandMarket,
  resolveWatchBandState,
} from "~/lib/watchlist-display";
import { formatWatchlistTrackingRole } from "~/lib/watchlist-role";

/**
 * Competitor band — brief §6.1 (R1 status row + R2 mixed weights).
 *
 * One FULL-WIDTH band per competitor, never a card grid, so the audit's 3+1
 * orphan tile hole cannot exist. Left cell: state stamp, competitor name and
 * three mono meta lines. Middle: the 30-day capture strip and its worded
 * legend (§6.2). Right: at most two actions — one Rank 2 and one Rank 3.
 *
 * Selection replaces the checkbox rail: the state stamp doubles as the
 * band-level select toggle (`aria-pressed`), and it names both the state and
 * the action in words so colour is never the only channel (§10).
 */

export interface CompetitorBandProps {
  id: string;
  name: string;
  targetLabel: string;
  trackingRole?: WatchlistTrackingRole;
  targetCountry: string | null;
  isActive: boolean;
  lastScannedAt: string | null;
  createdAt: string;
  plan: string;
  capturedChanges: number;
  /** Consecutive failed checks since the last successful one. */
  failedChecks?: number;
  captureDays: readonly CaptureDay[];
  captureEndDate: string;
  captureWindowDays: number;
  /** Durable-run scan truth, already resolved by the route. */
  scanLabel: string;
  scanTimestamp: string | null;
  isOpen: boolean;
  isPending: boolean;
  /** Bulk selection only exists once there are two competitors to act on. */
  selectable: boolean;
  selected: boolean;
  selectionDisabled?: boolean;
  onToggleSelect?: () => void;
  /** Rank 2 — the one repeatable action worth putting on a board row. */
  secondaryAction?: { label: string; to: string } | null;
  /** Rank 3 — supplied by the route because it posts a form. */
  tertiaryAction?: ReactNode;
}

export function CompetitorBand(props: CompetitorBandProps) {
  const stamp = resolveWatchBandState({
    isActive: props.isActive,
    lastScannedAt: props.lastScannedAt,
    capturedChanges: props.capturedChanges,
    failedChecks: props.failedChecks ?? 0,
  });
  // WP-C2 Beat 3: the first capture is the retention-critical moment, so its
  // live state stays visible on the board itself, not one click away.
  const awaitingFirstCapture = props.isActive && !props.lastScannedAt;
  const market = formatWatchBandMarket(props.targetCountry);
  const cadence = formatWatchBandCadence({ isActive: props.isActive, plan: props.plan });
  const openHref = `/app/watchlists?watchlist=${props.id}`;
  const classes = [
    "f9-ed-band",
    props.isOpen ? "is-open" : "",
    props.selected ? "is-selected" : "",
    props.isPending ? "is-pending" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classes} data-band-state={stamp.state}>
      <div className="f9-ed-band-cell f9-ed-band-identity">
        <div className="f9-ed-band-stamp-row">
          {props.selectable && props.onToggleSelect ? (
            <button
              aria-label={`${stamp.label} — select ${props.name} for bulk actions`}
              aria-pressed={props.selected}
              className="f9-ed-band-select"
              disabled={props.selectionDisabled}
              onClick={props.onToggleSelect}
              type="button"
            >
              <Pill state={stamp.pillState} variant="stamp">
                {stamp.label}
              </Pill>
              <span className="f9-ed-band-select-hint">
                {props.selected ? "Selected" : "Select"}
              </span>
            </button>
          ) : (
            <Pill state={stamp.pillState} variant="stamp">
              {stamp.label}
            </Pill>
          )}
        </div>

        <Link className="f9-ed-band-open" preventScrollReset to={openHref}>
          <h2 className="f9-ed-band-name">{props.name}</h2>
          <span className="f9-ed-band-target">
            {formatWatchlistTrackingRole(props.trackingRole)} · {props.targetLabel}
          </span>
          <span className="f9-ed-band-scan">
            {props.scanTimestamp ? (
              <>
                {props.scanLabel} <LocalTime iso={props.scanTimestamp} />
              </>
            ) : (
              props.scanLabel
            )}
          </span>
        </Link>

        <ul className="f9-ed-band-meta">
          <li className={market ? undefined : "is-missing"}>
            {market ? `Market · ${market}` : "Market · not recorded"}
          </li>
          <li>{cadence}</li>
          <li>
            Watching since <LocalTime iso={props.createdAt} mode="date" />
          </li>
        </ul>

        {awaitingFirstCapture ? (
          <p className="f9-ed-band-first-capture" role="status">
            <span aria-hidden="true" className="f9-checkout-pulse" />
            Waiting on the first capture — this page updates itself.
          </p>
        ) : null}

        {stamp.state === "attention" ? (
          <p className="f9-ed-band-attention" role="status">
            {props.failedChecks} checks in a row failed. Open this competitor for what to do next.
          </p>
        ) : null}
      </div>

      <div className="f9-ed-band-cell f9-ed-band-capture">
        <CaptureStrip
          days={props.captureDays}
          endDate={props.captureEndDate}
          startDate={props.createdAt}
          windowDays={props.captureWindowDays}
        />
      </div>

      <div className="f9-ed-band-cell f9-ed-band-actions">
        {props.secondaryAction ? (
          <SecondaryAction small to={props.secondaryAction.to}>
            {props.secondaryAction.label}
          </SecondaryAction>
        ) : null}
        {props.tertiaryAction}
      </div>
    </article>
  );
}
