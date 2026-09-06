import { Link, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { ReportsLockedState } from "~/components/reports-locked-state";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { WorkingHeader } from "~/components/workspace/working-header";

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
        timeLabel: string | null;
        timeAt: string | null;
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
      <DashboardPage className="f9-wk-page f9-wk-reports-index">
        <ReportsLockedState upgradeTo={data.upgradePath} />
      </DashboardPage>
    );
  }

  const latest = data.reports[0] ?? null;
  const sourceCount = data.reports.length;

  return (
    <DashboardPage className="f9-wk-page f9-wk-reports-index">
      <WorkingHeader
        action={latest ? { label: "Open the latest report", to: latest.href } : undefined}
        context={
          sourceCount === 0
            ? "Reports are built from the collections and competitors you already keep."
            : `${sourceCount} report ${sourceCount === 1 ? "source" : "sources"} on file. Open one to see the captures behind it.`
        }
        title="Reports"
      />

      {sourceCount === 0 ? (
        <section aria-labelledby="reports-empty-title" className="f9-wk-sec">
          <p className="f9-wk-kick">Report sources</p>
          <h2 className="f9-wk-reports-state-title" id="reports-empty-title">
            No report source yet
          </h2>
          <p className="f9-wk-reports-state-copy">
            A report starts with something you already track. Save ads into a collection
            or add a competitor; its report will open here with the captures that prove it.
          </p>
          <div className="f9-wk-reports-actions">
            <Link className="f9-wk-btn" to="/app/collections">
              Open collections
            </Link>
            <Link className="f9-wk-lnk" to="/app/watchlists">
              Open competitors <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
        </section>
      ) : (
        <section aria-labelledby="reports-list-title" className="f9-wk-sec">
          <h2 className="f9-wk-kick" id="reports-list-title">
            Available reports
          </h2>
          <RuledList aria-label="Available reports" role="list">
            {data.reports.map((report) => (
              <RuledRow
                key={report.id}
                name={report.title}
                role="listitem"
                say={report.description}
                status={report.typeLabel}
                time={
                  report.timeAt && report.timeLabel ? (
                    <>
                      {report.timeLabel}{" "}
                      <LocalTime fallback={report.timeAt} iso={report.timeAt} />
                    </>
                  ) : (
                    "No check yet"
                  )
                }
                to={report.href}
              />
            ))}
          </RuledList>
          <div className="f9-wk-reports-links">
            <Link className="f9-wk-lnk" to="/app/shares">
              Manage shared links{" "}
              <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
        </section>
      )}
    </DashboardPage>
  );
}
