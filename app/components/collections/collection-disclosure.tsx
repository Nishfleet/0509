import type { ReactNode } from "react";

/**
 * Rank-2 disclosure — brief §5 (Rank 2 is the default rank), §7 (the
 * collections create form is "demoted to a Rank-2 action that reveals a
 * panel"), §11 (no new client-side JS beyond what tabs and disclosure
 * require).
 *
 * Native `<details>`: zero JavaScript, keyboard-operable for free, and the
 * panel's markup stays in the document so nothing about it is hidden from
 * search, print or assistive tech — it is collapsed, not removed. The native
 * disclosure triangle is suppressed in CSS; the audit called those triangles
 * out by name on the old onboarding page.
 *
 * The summary carries the Rank-2 class pair rather than the `SecondaryAction`
 * component because a `<summary>` is the control here — wrapping a button
 * inside one would break the native toggle.
 */
export function CollectionDisclosure({
  summary,
  children,
  defaultOpen = false,
  className,
  rank = 2,
}: {
  /** Mono uppercase label, e.g. "New collection". */
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** 2 for a panel reveal (§7), 3 for a reversible in-row editor (§5). */
  rank?: 2 | 3;
}) {
  return (
    <details
      className={className ? `f9-ed-disclosure ${className}` : "f9-ed-disclosure"}
      open={defaultOpen}
    >
      <summary className={`f9-ed-cta f9-ed-cta--rank${rank}`}>{summary}</summary>
      <div className="f9-ed-disclosure-body">{children}</div>
    </details>
  );
}
