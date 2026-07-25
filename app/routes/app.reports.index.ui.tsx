import { Link, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { EmptyState } from "~/components/empty-state";
import { LocalTime } from "~/components/local-time";

export type ReportsIndexLoaderData =
  | {
      accessDenied: true;
      feature: "client_reports";
      plan: string;
      upgradePath: string;
      reports: [];
    }
  | {
      accessDenied: false;
      feature: "client_reports";
      plan: string;
      reports: Array<{
        id: string;
        href: string;
        typeLabel: string;
        title: string;
        description: string;
        updatedAt: string;
      }>;
    };

export const reportsIndexMeta: MetaFunction = () => [
  { title: "Reports | Five to Nine" },
  {
    name: "description",
    content: "Open proof-backed reports built from your collections and monitored competitors.",
  },
];

export function ReportsIndexHydrateFallback() {
  return <DashboardRouteLoading title="Reports" />;
}

export function ReportsIndexErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export function ReportsIndexRoute() {
  const data = useLoaderData<ReportsIndexLoaderData>();

  if (data.accessDenied) {
    return (
      <DashboardPage>
        <section className="f9-app-stack">
          <article aria-labelledby="reports-index-plan-title" className="f9-app-panel" role="status">
            <p className="f9-app-kicker">Reports</p>
            <h1 id="reports-index-plan-title">Reports are included in the Agency plan.</h1>
            <p>
              Upgrade before opening client reports. Your collections and monitoring remain available
              on their existing pages.
            </p>
            <Link className="f9-primary-button" to={data.upgradePath}>
              View Agency plan
            </Link>
          </article>
        </section>
      </DashboardPage>
    );
  }

  return (
    <DashboardPage>
      <DashboardPageHeader
        lead="Open a current proof-backed report from a collection or monitored competitor."
        title="Reports"
      />

      <section className="f9-app-panel">
        {data.reports.length === 0 ? (
          <EmptyState
            action={{ label: "Open collections", to: "/app/collections" }}
            description="Save ads to a collection or add a competitor, then return here to open its report."
            title="No report sources yet"
          >
            <Link className="f9-secondary-button" to="/app/watchlists">
              Open competitors
            </Link>
          </EmptyState>
        ) : (
          <div className="f9-work-list">
            {data.reports.map((report) => (
              <article className="f9-work-row" key={report.id}>
                <div>
                  <span className="f9-app-kicker">{report.typeLabel}</span>
                  <h2>{report.title}</h2>
                  <p>{report.description}</p>
                  <small>
                    Source updated <LocalTime fallback={report.updatedAt} iso={report.updatedAt} />
                  </small>
                </div>
                <Link className="f9-secondary-button" to={report.href}>
                  Open report
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </DashboardPage>
  );
}
