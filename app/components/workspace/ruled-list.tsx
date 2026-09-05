import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * BL-030 — the list is a list (concept v4).
 *
 * v3's failure mode was an expanded in-list exemplar: a mini-dashboard wedged
 * between the tabs and the records, which stopped the list from being a list.
 * A row here is five cells and nothing else — entity name, one plain sentence,
 * one status word, one time, one chevron — and depth lives in the detail pane.
 *
 * There are no boxes. A status is the word "Caught" in ink or "Quiet" in grey;
 * there is no chip, no badge and no underline. The only rule in the whole
 * container is the 1px separator.
 */

export interface RuledRowProps {
  /** The watched entity's name. Renders in Bricolage unless `plain`. */
  name: ReactNode;
  /** One plain sentence. Never a label stack. */
  say?: ReactNode;
  /** One status word. `statusTone` is never the only channel — the word says it. */
  status?: ReactNode;
  statusTone?: "quiet" | "on" | "bad";
  /** One time or date. */
  time?: ReactNode;
  /** Internal destination. The name is the link and the whole row is its hit area. */
  to?: string;
  /**
   * BL-031: an accessible name for the row's link when the visible name alone
   * is ambiguous. On /search twenty rows can all be called "Nykaa"; a link
   * named only "Nykaa" is a real defect for anyone reading the page through a
   * links list. The visible text is untouched — this only widens what the
   * link is CALLED, and the sentence it borrows is already in the row.
   */
  linkLabel?: string;
  onClick?: () => void;
  /**
   * A real control that must stay clickable inside the row (the bulk-select
   * checkbox). It sits above the row-wide hit area, so selecting a competitor
   * for a bulk pause never opens its detail by accident.
   */
  lead?: ReactNode;
  /**
   * Replaces the chevron with a real control (e.g. "Mark done"). Like `lead`
   * it sits above the row-wide hit area, so the control never opens the row.
   */
  trail?: ReactNode;
  /** Selected (the detail pane is showing this row). */
  selected?: boolean;
  /** Dimmed — paused, or otherwise not being checked. */
  off?: boolean;
  /** Route navigation is in flight for this row. */
  pending?: boolean;
  /**
   * BL-031: the row the roving keyboard cursor is on (j/k/arrows on /search).
   * It is a *cursor*, not a selection — the selected row is `selected` — so it
   * draws as a rule on the row's leading edge rather than as a second ground.
   */
  keyFocused?: boolean;
  /**
   * A summary row (Setup / Quiet / Checks) is not a watched entity, so it
   * does not get the display face. DNA: Bricolage means a watched entity.
   */
  plain?: boolean;
  id?: string;
  /**
   * Set to "listitem" when the enclosing RuledList declares `role="list"`.
   * An explicit list needs explicit items, otherwise assistive tech announces
   * a list with nothing in it. Left undefined the row emits no role at all,
   * so every existing caller renders byte-identical markup.
   */
  role?: "listitem";
}

export function RuledList({
  children,
  bleed = true,
  flush = false,
  ...rest
}: {
  children: ReactNode;
  /** Rows run to the page padding so hover reads as a full row. */
  bleed?: boolean;
  /** Drops the top rule when the container sits directly under another one. */
  flush?: boolean;
} & { "aria-label"?: string; role?: string }) {
  const className = ["f9-wk-rows", bleed ? "is-bleed" : null, flush ? "is-flush" : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}

export function RuledRow({
  name,
  say,
  status,
  statusTone = "quiet",
  time,
  to,
  linkLabel,
  onClick,
  lead,
  trail,
  selected = false,
  off = false,
  pending = false,
  plain = false,
  keyFocused = false,
  id,
  role,
}: RuledRowProps) {
  const className = [
    "f9-wk-row",
    plain ? "is-plain" : null,
    lead ? "has-lead" : null,
    trail ? "has-trail" : null,
    selected ? "is-sel" : null,
    off ? "is-off" : null,
    pending ? "is-pending" : null,
    keyFocused ? "is-key-focus" : null,
  ]
    .filter(Boolean)
    .join(" ");

  let nameCell: ReactNode = <span className="f9-wk-nm">{name}</span>;
  if (to) {
    nameCell = (
      <span className="f9-wk-nm">
        <Link
          aria-current={selected ? "true" : undefined}
          aria-label={linkLabel}
          className="f9-wk-rowlink"
          prefetch="intent"
          to={to}
        >
          {name}
        </Link>
      </span>
    );
  } else if (onClick) {
    nameCell = (
      <span className="f9-wk-nm">
        <button className="f9-wk-rowlink" onClick={onClick} type="button">
          {name}
        </button>
      </span>
    );
  }

  return (
    <div className={className} id={id} role={role}>
      {lead ? <span className="f9-wk-row-lead">{lead}</span> : null}
      {nameCell}
      <span className="f9-wk-say">{say}</span>
      <span className={`f9-wk-st${statusTone === "quiet" ? "" : ` is-${statusTone}`}`}>
        {status}
      </span>
      <span className="f9-wk-tm">{time}</span>
      {trail ? (
        <span className="f9-wk-row-trail">{trail}</span>
      ) : (
        <span aria-hidden="true" className="f9-wk-go">
          &rsaquo;
        </span>
      )}
    </div>
  );
}
