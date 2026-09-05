import { Link } from "react-router";

export interface PlanLimitStateProps {
  title?: string;
  message: string;
  current?: number;
  limit?: number;
}

export function PlanLimitState({
  title = "Plan limit reached",
  message,
  current,
  limit,
}: PlanLimitStateProps) {
  return (
    <div aria-live="polite" className="f9-dash-state f9-dash-state-limit" role="status">
      <h2>{title}</h2>
      <p>
        {message}
        {typeof current === "number" && typeof limit === "number"
          ? ` (${current} of ${limit} used)`
          : null}
      </p>
      <div className="f9-inline-actions">
        <Link className="f9-wk-btn" to="/app/billing?source=limit#plans">
          View plans
        </Link>
        <Link className="f9-wk-btn-quiet" to="/app/billing">
          Billing &amp; usage
        </Link>
      </div>
    </div>
  );
}
