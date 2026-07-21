import type { ReactNode } from "react";

/**
 * WP-C2 — shared "Wire register" presentation atoms (Direction B visuals,
 * Direction C copy). Atmosphere only: the deliverable noun stays "brief"; the
 * mono wire marks never become nav, titles, or the primary CTA.
 */

/** Mono kicker, e.g. `THE 5·9 WIRE · NOTHING FILED YET`. */
export function WireEyebrow({ children }: { children: ReactNode }) {
  return <span className="f9-wire-eyebrow">{children}</span>;
}

/**
 * Bricolage headline with a single green highlight-marker span (the one
 * expressive move per beat). `marked` is wrapped in the marker; `before`/`after`
 * render as plain display text around it.
 */
export function WireHeadline({
  before,
  marked,
  after,
}: {
  before?: ReactNode;
  marked: ReactNode;
  after?: ReactNode;
}) {
  return (
    <h2 className="f9-wire-headline">
      {before}
      <span className="f9-wire-mark">{marked}</span>
      {after}
    </h2>
  );
}

/** One rotated editorial classification stamp on the filed brief. */
export function WireStamp({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="f9-wire-stamp">
      {children}
    </span>
  );
}
