import type { ReactNode } from "react";

import { TertiaryAction } from "./cta";

/**
 * Quiet line — brief §6.7 (R2 Better Stack mixed weights).
 *
 * A check that found nothing is ONE dashed line: no card, no icon, no
 * warning styling, never apologised for and never omitted. The complete
 * audit trail is the retention argument, so quiet is a finding, not a gap.
 *
 * Runs collapse after the fifth into a Rank-3 "Load N earlier checks".
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
    <div className="f9-ed-quiet-line">
      {stamp ? <span className="f9-ed-quiet-stamp">{stamp}</span> : null}
      <p className="f9-ed-quiet-copy">{copy}</p>
    </div>
  );
}

export function QuietLineList({
  items,
  limit = QUIET_LINE_VISIBLE_LIMIT,
  expanded = false,
  loadMoreTo,
  onLoadMore,
}: {
  items: readonly QuietLineItem[];
  limit?: number;
  expanded?: boolean;
  /** URL-driven disclosure keeps the list free of client state (brief §11). */
  loadMoreTo?: string;
  onLoadMore?: () => void;
}) {
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, limit);
  const hidden = items.length - visible.length;

  return (
    <div className="f9-ed-quiet-list">
      {visible.map((item) => (
        <QuietLine key={item.id} stamp={item.stamp} copy={item.copy} />
      ))}
      {hidden > 0 ? (
        <TertiaryAction to={loadMoreTo} onClick={onLoadMore}>
          {`Load ${hidden} earlier ${hidden === 1 ? "check" : "checks"}`}
        </TertiaryAction>
      ) : null}
    </div>
  );
}
