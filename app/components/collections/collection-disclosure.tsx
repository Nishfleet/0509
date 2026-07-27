import type { ReactNode } from "react";

/**
 * Rank-2 disclosure — brief §5 (Rank 2 is the default rank), §7 (the
 * collections create form is "demoted to a Rank-2 action that reveals a
 * panel"), §11 (no new client-side JS beyond what tabs and disclosure
 * require).
 *
 * Native `<details>`: zero JavaScript, keyboard-operable for free, and the
 * summary always exposes the expanded/collapsed state to assistive tech. While
 * closed the panel's content is absent from the accessibility tree and out of
 * the tab order — the same as any collapsed disclosure — and it returns in
 * full on open; it is collapsed, not deleted from the document. The native
 * disclosure triangle is suppressed in CSS; the audit called those triangles
 * out by name on the old onboarding page.
 *
 * The summary carries the Rank-2 class pair rather than the `SecondaryAction`
 * component because a `<summary>` is the control here — wrapping a button
 * inside one would break the native toggle.
 */
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
  /** Mono uppercase label, e.g. "New collection". */
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
      className={className ? `f9-ed-disclosure ${className}` : "f9-ed-disclosure"}
      name={group}
      open={defaultOpen}
    >
      <summary className={`f9-ed-cta f9-ed-cta--rank${rank}`}>{summary}</summary>
      <div className="f9-ed-disclosure-body">{children}</div>
    </details>
  );
}
