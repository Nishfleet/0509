import type { ReactNode } from "react";

import { type ActionTarget, resolveActionTarget } from "./action-target";
import { TertiaryAction } from "./cta";

/**
 * Quiet line — brief §6.7 (R2 Better Stack mixed weights).
 *
 * A check that found nothing is ONE dashed line: no card, no icon, no
 * warning styling, never apologised for and never omitted. The complete
 * audit trail is the retention argument, so quiet is a finding, not a gap.
 *
 * Runs collapse after the fifth into a Rank-3 "Load N earlier checks" — but
 * only when the caller supplies somewhere for that control to go. Without a
 * target the list renders in full rather than hiding checks behind a button
 * that does nothing; the audit trail is never the thing that gets dropped.
 */

export const QUIET_LINE_VISIBLE_LIMIT = 5;

export interface QuietLineItem {
  id: string;
  /** Mono stamp, e.g. "26 Jul · 04:00". Omitted when we do not have one. */
  stamp?: ReactNode | null;
  /** What the check found, in product voice. */
  copy: string;
}

export function QuietLine({ stamp, copy }: { stamp?: ReactNode | null; copy: ReactNode }) {
  return (
    <div className="f9-evidence-quiet-line">
      {stamp ? <span className="f9-evidence-quiet-stamp">{stamp}</span> : null}
      <p className="f9-evidence-quiet-copy">{copy}</p>
    </div>
  );
}

export function QuietLineList({
  items,
  limit = QUIET_LINE_VISIBLE_LIMIT,
  expanded = false,
  loadMore,
}: {
  items: readonly QuietLineItem[];
  limit?: number;
  expanded?: boolean;
  /**
   * Where "Load N earlier checks" goes. URL-driven disclosure (`{ to }`)
   * keeps the list free of client state (brief §11).
   */
  loadMore?: ActionTarget;
}) {
  if (items.length === 0) return null;

  const collapsible = Boolean(loadMore) && !expanded;
  const visible = collapsible ? items.slice(0, limit) : items;
  const hidden = items.length - visible.length;

  return (
    <div className="f9-evidence-quiet-list">
      {visible.map((item) => (
        <QuietLine key={item.id} stamp={item.stamp} copy={item.copy} />
      ))}
      {loadMore && hidden > 0 ? (
        <TertiaryAction {...resolveActionTarget(loadMore)}>
          {`Load ${hidden} earlier ${hidden === 1 ? "check" : "checks"}`}
        </TertiaryAction>
      ) : null}
    </div>
  );
}
