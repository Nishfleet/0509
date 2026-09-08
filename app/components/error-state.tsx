import { Link, useRevalidator } from "react-router";

import { mapCustomerRouteError } from "~/lib/customer-route-error";

export interface ErrorStateProps {
  error?: unknown;
  title?: string;
  message?: string;
  retryable?: boolean;
}

export function ErrorState({ error, title, message, retryable }: ErrorStateProps) {
  const revalidator = useRevalidator();
  const mapped = error ? mapCustomerRouteError(error) : null;
  const resolvedTitle = title ?? mapped?.title ?? "Something went wrong";
  const resolvedMessage =
    message ?? mapped?.message ?? "We could not load this page. Try again or contact support.";
  const canRetry = retryable ?? mapped?.retryable ?? true;

  return (
    <div className="f9-dash-state f9-dash-state-error" role="alert" tabIndex={-1}>
      <h2>{resolvedTitle}</h2>
      <p>{resolvedMessage}</p>
      <div className="f9-inline-actions">
        {canRetry ? (
          <button
            className="f9-wk-btn-quiet"
            disabled={revalidator.state === "loading"}
            onClick={() => revalidator.revalidate()}
            type="button"
          >
            {revalidator.state === "loading" ? "Retrying…" : "Try again"}
          </button>
        ) : null}
        <Link className="f9-wk-btn-quiet" to="/app/support">
          Contact support
        </Link>
      </div>
    </div>
  );
}
