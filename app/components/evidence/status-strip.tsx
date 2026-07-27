import type { ReactNode } from "react";

import { TertiaryAction } from "./cta";
import { DEFAULT_MISSING_VALUE, isMissingFactValue } from "./fact-rail";

/**
 * Status strip — brief §6.3 (R1 incident.io single status row).
 *
 * ONE horizontal ruled row directly under the page title, replacing the seven
 * scattered status cards the audit found: tracking card, capacity note,
 * staleness note, paused-reason banner and friends all collapse into this.
 *
 * A cell with no value renders the honest inline value (§6.6) — never a
 * spinner, never a card, never a hole. Maximum five cells including the
 * single Rank-3 action, because a strip that grows is a dashboard again.
 */

export const STATUS_STRIP_MAX_CELLS = 5;

export interface StatusCell {
  /** Mono uppercase label. */
  key: string;
  value?: ReactNode | null;
  /** Sentence-case honesty copy when the value is missing. */
  missingLabel?: string;
}

export interface StatusStripAction {
  label: string;
  to?: string;
  onClick?: () => void;
}

export function StatusStrip({
  cells,
  action,
  className,
  ariaLabel = "Status",
}: {
  cells: readonly StatusCell[];
  action?: StatusStripAction;
  className?: string;
  ariaLabel?: string;
}) {
  const budget = action ? STATUS_STRIP_MAX_CELLS - 1 : STATUS_STRIP_MAX_CELLS;
  const visible = cells.slice(0, Math.max(0, budget));
  if (visible.length === 0 && !action) return null;

  return (
    <div
      className={className ? `f9-ed-status-strip ${className}` : "f9-ed-status-strip"}
      role="group"
      aria-label={ariaLabel}
    >
      {visible.map((cell) => {
        const missing = isMissingFactValue(cell.value);
        return (
          <div className="f9-ed-status-cell" key={cell.key}>
            <span className="f9-ed-status-key">{cell.key}</span>
            <span className={missing ? "f9-ed-status-value is-missing" : "f9-ed-status-value"}>
              {missing ? (cell.missingLabel ?? DEFAULT_MISSING_VALUE) : cell.value}
            </span>
          </div>
        );
      })}
      {action ? (
        <div className="f9-ed-status-cell">
          <TertiaryAction to={action.to} onClick={action.onClick}>
            {action.label}
          </TertiaryAction>
        </div>
      ) : null}
    </div>
  );
}
