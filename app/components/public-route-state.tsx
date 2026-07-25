import { Link, useRevalidator } from "react-router";

import { RouteSkeleton } from "~/components/route-skeleton";
import { mapCustomerRouteError } from "~/lib/customer-route-error";
import { DashboardShell } from "~/components/dashboard-shell";

/**
 * Public (logged-out) loading + error states for the /search route.
 *
 * These now wrap in DashboardShell(isPublic) to match the loaded public
 * /search chrome (minimal PUBLIC_SEARCH_NAV rail + f9-search-page), eliminating
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
      pageClassName="f9-search-page"
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
      pageClassName="f9-search-page"
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
              className="f9-primary-button"
              disabled={revalidator.state === "loading"}
              onClick={() => revalidator.revalidate()}
              type="button"
            >
              {revalidator.state === "loading" ? "Retrying…" : "Try again"}
            </button>
          ) : null}
          <Link className="f9-secondary-button" to="/">
            Back to Five to Nine
          </Link>
        </div>
      </div>
    </DashboardShell>
  );
}
