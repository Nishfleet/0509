import { Link, useLocation, useRevalidator } from "react-router";
import { useEffect, useMemo, useState } from "react";

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

const RATE_LIMIT_SESSION_KEY = "f9.search.rateLimit";

function formatCountdown(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface RateLimitErrorData {
  error: string;
  message?: string;
  retryAfter?: number;
}

/**
 * Rate-limit error state for anonymous /search.
 *
 * Shows the policy (20 requests / 10 min / IP), an absolute retry time, and a
 * minute:second countdown. The "Try again" button is disabled until the window
 * clears, then submits a form that carries the original q/country parameters so
 * the user is not forced to re-type. The original search state is also written
 * to sessionStorage for sign-in recovery.
 */
export function PublicSearchRateLimitError({ error }: { error: unknown }) {
  const location = useLocation();

  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const query = searchParams.get("q") ?? searchParams.get("query") ?? "";
  const country = searchParams.get("country") ?? "all";

  const data = useMemo<RateLimitErrorData | null>(() => {
    if (!error || typeof error !== "object") return null;
    if (!("data" in error)) return null;
    const maybe = (error as { data?: unknown }).data;
    if (!maybe || typeof maybe !== "object") return null;
    return maybe as RateLimitErrorData;
  }, [error]);

  const baseMessage =
    data?.message ??
    "You’ve hit the search limit. Wait a moment and try again.";

  const initialSeconds =
    typeof data?.retryAfter === "number" ? Math.max(0, data.retryAfter) : 0;

  const [secondsRemaining, setSecondsRemaining] = useState(initialSeconds);

  useEffect(() => {
    if (secondsRemaining <= 0) return;
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsRemaining]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    try {
      window.sessionStorage.setItem(
        RATE_LIMIT_SESSION_KEY,
        JSON.stringify({
          q: query,
          query,
          country,
          search: location.search,
          pathname: location.pathname,
        }),
      );
    } catch {
      // sessionStorage is optional; fail silently.
    }
  }, [query, country, location.search, location.pathname]);

  const canRetry = secondsRemaining <= 0;

  const retryAt = useMemo(() => {
    if (secondsRemaining <= 0) return null;
    return new Date(Date.now() + secondsRemaining * 1000);
  }, [secondsRemaining]);

  const retryTimeLabel = useMemo(() => {
    if (!retryAt) return null;
    return retryAt.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }, [retryAt]);

  const countdownLabel = useMemo(() => {
    if (secondsRemaining <= 0) return null;
    return formatCountdown(secondsRemaining);
  }, [secondsRemaining]);

  const message = useMemo(() => {
    const cleanBase = baseMessage
      .replace(/(\s*—\s*)?wait a few minutes and try again\.?$/i, "")
      .trim();
    if (retryTimeLabel && countdownLabel) {
      return `${cleanBase} — Try again at ${retryTimeLabel} (${countdownLabel} remaining)`;
    }
    return cleanBase;
  }, [baseMessage, retryTimeLabel, countdownLabel]);

  const buttonLabel =
    secondsRemaining > 0 && countdownLabel
      ? `Try again in ${countdownLabel}`
      : "Try again";

  const retryPath = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of searchParams) {
      params.set(key, value);
    }
    const queryString = params.toString();
    return `${location.pathname}${queryString ? `?${queryString}` : ""}`;
  }, [location.pathname, searchParams]);

  const signInRedirect = useMemo(
    () => `/auth/login?redirectTo=${encodeURIComponent(retryPath)}`,
    [retryPath],
  );

  const retryAtIso = retryAt?.toISOString() ?? null;

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
        data-f9-search-query={query}
        data-f9-search-country={country}
        data-f9-search-retry-at={retryAtIso ?? undefined}
      >
        <h2>Too many searches</h2>
        <p data-testid="rate-limit-message" suppressHydrationWarning>
          {message}
        </p>
        <form
          id="f9-rate-limit-retry"
          method="get"
          action={location.pathname}
          hidden
        >
          {Array.from(searchParams.entries()).map(([name, value]) => (
            <input
              key={`${name}-${value}`}
              type="hidden"
              name={name}
              value={value}
            />
          ))}
        </form>
        <div className="f9-inline-actions">
          <button
            className="f9-wk-btn"
            data-retry-seconds={
              secondsRemaining > 0 ? secondsRemaining : undefined
            }
            data-retry-url={retryPath}
            disabled={!canRetry}
            form="f9-rate-limit-retry"
            type="submit"
          >
            {buttonLabel}
          </button>
          <Link className="f9-wk-btn-quiet" to="/">
            Back to Five to Nine
          </Link>
          <Link className="f9-wk-btn-quiet" to={signInRedirect}>
            Sign in for more searches
          </Link>
        </div>
      </div>
    </DashboardShell>
  );
}
