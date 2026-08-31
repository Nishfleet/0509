import { Link, useRevalidator } from "react-router";
import { useEffect, useState } from "react";

import { RouteSkeleton } from "~/components/route-skeleton";
import { mapCustomerRouteError } from "~/lib/customer-route-error";
import { DashboardShell } from "~/components/dashboard-shell";

/**
 * Public (logged-out) loading + error states for the /search route.
 *
 * These now wrap in DashboardShell(isPublic) to match the loaded public
 * /search chrome (minimal PUBLIC_SEARCH_NAV rail + f9-find-page), eliminating
 * layout shift on hydration/error. The shell with isPublic provides the
 * appropriate public bone "Caught in the act" framing without full workspace
 * nav. Voice rule 6 for errors.
 */
export function PublicSearchLoading() {
  return (
    <DashboardShell
      accountDetail="Find competitor ads"
      accountLabel="Search"
      accountTitle="Five to Nine"
      isPublic
      pageClassName="f9-find-page"
    >
      <RouteSkeleton label="Loading competitor ads and landing pages" />
    </DashboardShell>
  );
}

export function PublicSearchError({ error }: { error: unknown }) {
  const revalidator = useRevalidator();
  const mapped = error ? mapCustomerRouteError(error) : null;
  const title = mapped?.title ?? "Search hit a snag";
  const message =
    mapped?.message ??
    "We couldn't load search just now. We're retrying the request. Try again, or head back to the start.";
  const canRetry = mapped?.retryable ?? true;

  return (
    <DashboardShell
      accountDetail="Find competitor ads"
      accountLabel="Search"
      accountTitle="Five to Nine"
      isPublic
      pageClassName="f9-find-page"
    >
      <div
        aria-live="assertive"
        className="f9-dash-state f9-dash-state-error"
        role="alert"
        tabIndex={-1}
      >
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="f9-inline-actions">
          {canRetry ? (
            <button
              className="f9-wk-btn"
              disabled={revalidator.state === "loading"}
              onClick={() => revalidator.revalidate()}
              type="button"
            >
              {revalidator.state === "loading" ? "Retrying…" : "Try again"}
            </button>
          ) : null}
          <Link className="f9-wk-btn-quiet" to="/">
            Back to Five to Nine
          </Link>
        </div>
      </div>
    </DashboardShell>
  );
}

/**
 * Rate-limit error state for anonymous /search.
 *
 * Shows the policy (20 requests per 10 minutes per IP), a countdown derived
 * from the Retry-After header, and a working "Try again" button that
 * re-triggers the search without a full page reload. The countdown updates
 * client-side every 10 seconds; on reaching zero it auto-revalidates so the
 * page returns to results state once the limit window clears.
 */
export function PublicSearchRateLimitError({ error }: { error: unknown }) {
  const revalidator = useRevalidator();

  // Extract retryAfter from the thrown response body (set by the loader).
  const retryAfterFromError =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: { retryAfter?: number } }).data?.retryAfter
      : null;

  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(
    retryAfterFromError ?? null,
  );

  // Countdown timer: decrement by 10 every 10 seconds so the visible value
  // matches the per-tick granularity the spec asks for. Using Math.max keeps
  // a stale value (e.g. a Retry-After already past) pinned at 0 instead of
  // drifting negative.
  useEffect(() => {
    if (secondsRemaining === null || secondsRemaining <= 0) return;
    const timer = setInterval(() => {
      setSecondsRemaining((prev) =>
        prev === null || prev <= 10 ? 0 : prev - 10,
      );
    }, 10_000);
    return () => clearInterval(timer);
  }, [secondsRemaining]);

  // Auto-revalidate when countdown reaches zero so the page leaves the rate-
  // limit state as soon as the limiter's window clears.
  useEffect(() => {
    if (secondsRemaining === 0) {
      revalidator.revalidate();
    }
  }, [secondsRemaining, revalidator]);

  const minutes = secondsRemaining !== null
    ? Math.ceil(secondsRemaining / 60)
    : null;
  const minuteLabel = minutes !== null
    ? `${minutes} minute${minutes !== 1 ? "s" : ""}`
    : null;
  const countdownCopy = minuteLabel
    ? `Retry in ${minuteLabel} (${secondsRemaining}s)`
    : "Retry window open — Try again to refresh results.";
  const message = `20 requests per 10 minutes per IP — ${countdownCopy}`;

  return (
    <DashboardShell
      accountDetail="Find competitor ads"
      accountLabel="Search"
      accountTitle="Five to Nine"
      isPublic
      pageClassName="f9-find-page"
    >
      <div
        aria-live="assertive"
        className="f9-dash-state f9-dash-state-error"
        role="alert"
        tabIndex={-1}
      >
        <h2>Too many searches</h2>
        <p data-testid="rate-limit-message">{message}</p>
        <div className="f9-inline-actions">
          <button
            className="f9-wk-btn"
            disabled={revalidator.state === "loading"}
            onClick={() => revalidator.revalidate()}
            type="button"
          >
            {revalidator.state === "loading" ? "Retrying…" : "Try again"}
          </button>
          <Link className="f9-wk-btn-quiet" to="/">
            Back to Five to Nine
          </Link>
        </div>
      </div>
    </DashboardShell>
  );
}
