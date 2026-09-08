import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * BL-030 — the working page header (concept v4).
 *
 * The literal header contract measured off Attio / incident.io / Linear:
 * ONE row, title left, at most one action inline right, then a single
 * sentence-case context line under it. 28px Bricolage is the page's whole
 * display budget; nothing else on the page may be larger.
 *
 * `action` is the page's single filled button. Zero is legitimate (a
 * settings surface has nothing to do); two is a bug.
 */
export interface WorkingHeaderAction {
  label: string;
  /** Internal route — renders a react-router <Link>. */
  to?: string;
  /** Click handler — renders a <button> (e.g. opens the command palette). */
  onClick?: () => void;
  "aria-haspopup"?: "dialog";
  "aria-keyshortcuts"?: string;
}

export interface WorkingHeaderProps {
  title: ReactNode;
  /** The one line that qualifies the title: date, count, whether it ran. */
  context?: ReactNode;
  action?: WorkingHeaderAction | null;
  /**
   * A form-backed primary for routes whose one working action is a mutation.
   * The header owns placement; the route keeps submission and pending state.
   */
  actionSlot?: ReactNode;
  titleId?: string;
}

export function WorkingHeader({
  title,
  context,
  action,
  actionSlot,
  titleId,
}: WorkingHeaderProps) {
  return (
    <header className="f9-wk-head">
      <div className="f9-wk-head-top">
        <h1 className="f9-wk-title" id={titleId}>
          {title}
        </h1>
        {actionSlot ?? (action ? <WorkingHeaderButton action={action} /> : null)}
      </div>
      {context ? <p className="f9-wk-context">{context}</p> : null}
    </header>
  );
}

function WorkingHeaderButton({ action }: { action: WorkingHeaderAction }) {
  if (action.to) {
    return (
      <Link className="f9-wk-btn" prefetch="intent" to={action.to}>
        {action.label}
      </Link>
    );
  }
  return (
    <button
      aria-haspopup={action["aria-haspopup"]}
      aria-keyshortcuts={action["aria-keyshortcuts"]}
      className="f9-wk-btn"
      onClick={action.onClick}
      type="button"
    >
      {action.label}
    </button>
  );
}
