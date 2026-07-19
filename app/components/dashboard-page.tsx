import type { ReactNode } from "react";
import { Link } from "react-router";

export interface DashboardPageProps {
  children: React.ReactNode;
  className?: string;
}

export function DashboardPage({ children, className }: DashboardPageProps) {
  return (
    <div className={className ? `f9-dash-content ${className}` : "f9-dash-content"}>
      {children}
    </div>
  );
}

export interface DashboardPageHeaderProps {
  kicker?: ReactNode;
  title: ReactNode;
  lead?: string;
  action?: { label: string; to: string };
}

export function DashboardPageHeader({ kicker, title, lead, action }: DashboardPageHeaderProps) {
  return (
    <header className="f9-dash-page-header">
      <div>
        {kicker ? <span className="f9-app-kicker">{kicker}</span> : null}
        <h1>{title}</h1>
        {lead ? <p className="f9-muted-copy">{lead}</p> : null}
      </div>
      {action ? (
        <Link className="f9-secondary-button" to={action.to}>
          {action.label}
        </Link>
      ) : null}
    </header>
  );
}
