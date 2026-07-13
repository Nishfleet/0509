import type { ReactNode } from "react";
import { Link } from "react-router";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; to: string };
  /** Heading element for the panel variant; keep page outlines coherent. */
  headingLevel?: "h2" | "h3";
  /**
   * panel — dashed workspace card (default, f9-dash-state-empty)
   * inline — single muted sentence inside an existing panel
   * row — placeholder row inside an f9-work-list
   */
  variant?: "panel" | "inline" | "row";
  children?: ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
  headingLevel = "h2",
  variant = "panel",
  children,
}: EmptyStateProps) {
  if (variant === "inline") {
    return (
      <p className="f9-muted-copy f9-empty-inline" role="status">
        {title}
        {description ? <> {description}</> : null}
      </p>
    );
  }

  if (variant === "row") {
    return (
      <div className="f9-work-row f9-empty-row" role="status">
        <div>
          <strong>{title}</strong>
          {description ? <p className="f9-muted-copy">{description}</p> : null}
        </div>
        {children}
      </div>
    );
  }

  const Heading = headingLevel;

  return (
    <div className="f9-dash-state f9-dash-state-empty" role="status">
      <Heading>{title}</Heading>
      {description ? <p>{description}</p> : null}
      {action ? (
        <Link className="f9-primary-button" to={action.to}>
          {action.label}
        </Link>
      ) : null}
      {children}
    </div>
  );
}
