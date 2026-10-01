import type { Route } from "./+types/app.alerts";

import { env } from "cloudflare:workers";
import { Link } from "react-router";

import { AlertChips } from "../components/alert-chips";
import { AlertFeed } from "../components/alert-feed";
import { IncidentSlot } from "../components/incident-block";
import { PAGE, PageHeading } from "../components/page-heading";
import { SourcePill } from "../components/source-pill";
import { acknowledgeOwnSiteIncident, loadAlertsPage } from "../lib/alerts-page.server";
import { parseAlertChip } from "../lib/alert-chips";
import { listBriefs } from "../lib/data/digest.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { requireFreshSession, requireSession } from "../lib/require-session.server";

export function meta() {
  return [{ title: "Alerts · Five to Nine" }];
}

const WHEN_CLASS = "mt-2 block font-mono text-meta text-ink-soft uppercase";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const page = await loadAlertsPage(session.user.id, parseAlertChip(new URL(request.url).searchParams.get("kind")));
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const latest = workspaceId === null ? undefined : (await listBriefs(env.DB, workspaceId))[0];
  const failedBrief = latest?.status === "failed" ? { id: latest.id } : null;
  return { ...page, failedBrief };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireFreshSession(request);
  const form = await request.formData();
  const alertId = form.get("alertId");
  if (form.get("intent") !== "acknowledge" || typeof alertId !== "string") return { saved: false };
  await acknowledgeOwnSiteIncident(session.user.id, alertId);
  return { saved: true };
}

function BriefSendFailed({ failed }: { failed: { id: string } }) {
  return (
    <p role="alert" data-alert="brief-send-failed" className="mt-4 leading-[1.65]">
      We could not email your weekly brief.{" "}
      <Link className="underline decoration-1 underline-offset-4" to={`/app/brief/${failed.id}`}>
        Read it in the app
      </Link>
      .
    </p>
  );
}

function OwnSiteIncident({ incident }: { incident: Route.ComponentProps["loaderData"]["incidents"][number] }) {
  return (
    <article id={incident.id} data-testid="own-site-incident" className="mt-8 border-t border-line pt-6">
      <h2 className="font-display text-row-name font-bold [overflow-wrap:anywhere]">{incident.title}</h2>
      <p className="mt-2 leading-[1.65]">
        {incident.fixed === null
          ? "We check it again every hour and email you once it's fixed."
          : `Fixed ${incident.fixed}.`}
      </p>
      <time dateTime={incident.created_at} className={WHEN_CLASS}>
        {incident.when}
      </time>
    </article>
  );
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main className={PAGE}>
      <PageHeading title="Alerts" />
      <p data-testid="alerts-contract" className="mt-2 leading-[1.65] text-ink-soft">
        We only email you right away when your own website breaks. Everything else waits here.
      </p>
      {loaderData.failedBrief === null ? null : <BriefSendFailed failed={loaderData.failedBrief} />}
      <IncidentSlot incident={loaderData.openIncident} />
      {loaderData.sources.length > 0 ? (
        <p data-testid="alerts-sources" className="mt-4 flex flex-wrap gap-2">
          {loaderData.sources.map((entry) => (
            <SourcePill key={entry.source.key} source={entry.source} snapshot={entry.snapshot} now={loaderData.now} />
          ))}
        </p>
      ) : null}
      {loaderData.incidents.map((incident) => (
        <OwnSiteIncident key={incident.id} incident={incident} />
      ))}
      <AlertChips chip={loaderData.chip} counts={loaderData.chipCounts} hiringCapped={loaderData.hiringCapped} />
      {loaderData.chipCounts.all === 0 && loaderData.openIncident === null ? (
        <p className="mt-8 leading-[1.65]">
          Nothing yet. When a competitor changes its website, gets a mention or posts a job, it will show up here.
        </p>
      ) : null}
      <AlertFeed groups={loaderData.groups} />
      {loaderData.offLine === null ? null : (
        <p data-testid="alerts-off-footer" className="mt-10 border-t border-line pt-6 leading-[1.65] text-ink-soft">
          {loaderData.offLine}
        </p>
      )}
    </main>
  );
}
