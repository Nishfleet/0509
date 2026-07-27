import { useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { LockedFeature } from "~/components/locked-feature";
import { SecondaryAction, SpecimenEmptyState, TertiaryAction } from "~/components/evidence";

/**
 * The report shelf — BL-009. Brief §6.1 (one full-width band per item, so a
 * 3+1 orphan hole cannot form), §6.8 (a designed empty state and a designed
 * plan gate, never a void), §5 (one Rank-1: open the report that is ready to
 * send; "Manage shared links" is cross-navigation and drops to Rank 3 per
 * DESIGN.md WP-A3).
 */

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

function ReportsGateSpecimen() {
  return (
    <div className="f9-ed-report-specimen">
      <p className="f9-ed-micro">Sample · not your workspace</p>
      <p className="f9-ed-report-specimen-headline">Okara cut its team price by a third</p>
      <div className="f9-ed-report-specimen-numbers">
        <span>
          <strong>7</strong>
          Changes captured
        </span>
        <span>
          <strong>3</strong>
          Offer pages moved
        </span>
        <span>
          <strong>26 d</strong>
          History behind it
        </span>
      </div>
      <p className="f9-ed-micro">Plate 01 — offer page · verified evidence</p>
    </div>
  );
}

export function ReportsIndexRoute() {
  const data = useLoaderData<ReportsIndexLoaderData>();

  if (data.accessDenied) {
    return (
      <DashboardPage>
        <section className="f9-app-stack">
          <LockedFeature
            eyebrow="Reports"
            planNeeded="Agency plan"
            reason="Open client-ready reports and share the evidence with your team"
            specimen={<ReportsGateSpecimen />}
            specimenLabel="What an Agency report looks like"
            title="Client-ready reports"
            upgradeTo={data.upgradePath}
          />
        </section>
      </DashboardPage>
    );
  }

  const latest = data.reports[0] ?? null;

  return (
    <DashboardPage>
      <DashboardPageHeader
        action={latest ? { label: "Open the latest report", to: latest.href } : undefined}
        lead="Open a current proof-backed report from a collection or monitored competitor. Every one carries the captures behind it."
        title="Reports"
      />

      {data.reports.length === 0 ? (
        <SpecimenEmptyState
          copy="A report is built from something you already track. Save ads into a collection or add a competitor, and its report opens here with the captures that prove it."
          headline="No report source yet"
          primaryAction={{ label: "Open collections", to: "/app/collections" }}
          secondaryAction={{ label: "Open competitors", to: "/app/watchlists" }}
          specimen={<ReportsGateSpecimen />}
          specimenLabel="Plate 01 — pending"
          stateLabel="Reports · no source yet"
        />
      ) : (
        <>
          <div className="f9-ed-report-shelf">
            {data.reports.map((report) => (
              <article className="f9-ed-report-band" key={report.id}>
                <div className="f9-ed-report-band-id">
                  <p className="f9-ed-micro">{report.typeLabel}</p>
                  <h2>{report.title}</h2>
                </div>
                <div className="f9-ed-report-band-body">
                  <p>{report.description}</p>
                  <p className="f9-ed-evidence-line">
                    Source updated{" "}
                    <LocalTime fallback={report.updatedAt} iso={report.updatedAt} />
                  </p>
                </div>
                <div className="f9-ed-report-band-action">
                  <SecondaryAction to={report.href}>Open report</SecondaryAction>
                </div>
              </article>
            ))}
          </div>
          <p className="f9-ed-report-shelf-foot">
            <TertiaryAction to="/app/shares">Manage shared links</TertiaryAction>
          </p>
        </>
      )}
    </DashboardPage>
  );
}
