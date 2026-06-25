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
    <div className="f9-dash-state f9-dash-state-limit" role="status">
      <h2>{title}</h2>
      <p>
        {message}
        {typeof current === "number" && typeof limit === "number"
          ? ` (${current} of ${limit} used.)`
          : null}
      </p>
      <div className="f9-inline-actions">
        <Link className="f9-primary-button" to="/#pricing">
          View plans
        </Link>
        <Link className="f9-secondary-button" to="/app/billing">
          Billing &amp; usage
        </Link>
      </div>
    </div>
  );
}
