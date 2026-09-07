import type { ReactNode } from "react";

/**
 * The page's own panels — Export, Add an evidence link, New collection — open
 * one at a time, so the route can never stack every form open at once.
 */
export const COLLECTION_PANEL_GROUP = "f9-collection-panel";

/** One saved item's editor at a time, for the same reason. */
export const COLLECTION_ITEM_GROUP = "f9-collection-item";

export function CollectionDisclosure({
  summary,
  children,
  defaultOpen = false,
  className,
  rank = 2,
  group,
}: {
  /** Sentence-case navigation label, e.g. "New collection". */
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** 2 for a panel reveal (§7), 3 for a reversible in-row editor (§5). */
  rank?: 2 | 3;
  /**
   * Native exclusive-accordion group (`<details name>`): opening one panel in
   * the group closes the others, so the page cannot stack every form open at
   * once. Still zero JavaScript, and a browser without the feature simply
   * keeps them independent — the pre-accordion behaviour, never a broken one.
   */
  group?: string;
}) {
  return (
    <details
      className={className ? `f9-library-disclosure ${className}` : "f9-library-disclosure"}
      name={group}
      open={defaultOpen}
    >
      <summary className={`f9-wk-lnk f9-library-disclosure-summary is-rank-${rank}`}>
        {summary}
        <span aria-hidden="true" className="f9-wk-chev">
          &rsaquo;
        </span>
      </summary>
      <div className="f9-library-disclosure-body">{children}</div>
    </details>
  );
}
