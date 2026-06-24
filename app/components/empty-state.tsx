import { Link } from "react-router";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; to: string };
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="f9-dash-state f9-dash-state-empty" role="status">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? (
        <Link className="f9-primary-button" to={action.to}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
