import { useEffect, useState } from "react";

const SLOW_LOAD_MS = 8000;

export interface RouteSkeletonProps {
  label?: string;
}

export function RouteSkeleton({ label = "Loading workspace…" }: RouteSkeletonProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div aria-busy="true" aria-live="polite" className="f9-dash-state f9-dash-state-skeleton">
      <p className="f9-dash-skeleton-pulse">{label}</p>
      <div className="f9-dash-skeleton-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {slow ? (
        <p className="f9-wk-dim">
          Still loading — check your connection or try refreshing the page.
        </p>
      ) : null}
    </div>
  );
}
