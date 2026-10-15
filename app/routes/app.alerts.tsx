import type { Route } from "./+types/app.alerts";

import { Link, type ShouldRevalidateFunctionArgs } from "react-router";
import { z } from "zod";

import { ChipFeed } from "../components/alert-chip-feed";
import { AlertsFoot } from "../components/alert-help";
import { IncidentSlot } from "../components/incident-block";
import { PAGE, PageHeading } from "../components/page-heading";
import { SourcePill } from "../components/source-pill";
import { acknowledgeOwnSiteIncident, loadAlertsPage } from "../lib/alerts-page.server";
import { newSinceBriefLine } from "../lib/alerts-new";
import { listWorkspaceBriefs } from "../lib/data/digest.server";
import { onboardedContext } from "../lib/require-onboarded.server";
import { requireFreshSession } from "../lib/require-session.server";

export function meta() {
  return [{ title: "Alerts · Five to Nine" }];
}

const WHEN_CLASS = "mt-2 block font-mono text-meta text-ink-soft uppercase";

const acknowledgeForm = z.object({
  intent: z.literal("acknowledge"),
  alertId: z.string(),
});

async function readBriefs(workspaceId: string | null) {
  return workspaceId === null ? [] : listWorkspaceBriefs(workspaceId);
}

export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  const onlyFilterChanged = currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search;
  return onlyFilterChanged ? false : defaultShouldRevalidate;
}

export async function loader({ context }: Route.LoaderArgs) {
  const { workspaceId } = context.get(onboardedContext);
  const [page, briefs] = await Promise.all([loadAlertsPage(workspaceId), readBriefs(workspaceId)]);
  const latest = briefs[0];
  const lastSent = briefs.find((brief) => brief.status === "sent");
  const failedBrief = latest?.status === "failed" ? { id: latest.id } : null;
  const times = page.groups.flatMap((group) => group.items.map((item) => item.at));
  return { ...page, failedBrief, newSince: newSinceBriefLine(times, lastSent?.period_end) };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireFreshSession(request);
  const parsed = acknowledgeForm.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { saved: false };
  await acknowledgeOwnSiteIncident(session.user.id, parsed.data.alertId);
  return { saved: true };
}

function BriefSendFailed({ failed }: { failed: { id: string } }) {
  return (
    <p role="alert" data-alert="brief-send-failed" className="mt-4 leading-[1.65]">
      We couldn't email your weekly brief.{" "}
      <Link
        className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4"
        to={`/app/brief/${failed.id}`}
      >
        Read it in the app
      </Link>
      .
    </p>
  );
}

function NewSince({ line }: { line: string | null }) {
  if (line === null) return null;
  return (
    <p data-testid="alerts-new-since" className="mt-4 font-display font-bold">
      {line}
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
      <NewSince line={loaderData.newSince} />
      {loaderData.failedBrief === null ? null : <BriefSendFailed failed={loaderData.failedBrief} />}
      <IncidentSlot incident={loaderData.openIncident} />
      {loaderData.sources.length > 0 ? (
        <p data-testid="alerts-sources" className="mt-4 flex flex-wrap gap-2">
          {loaderData.sources.map((entry) => (
            <SourcePill
              key={entry.source.key}
              source={{ ...entry.source, kind: entry.kind }}
              snapshot={entry.snapshot}
              now={loaderData.now}
            />
          ))}
        </p>
      ) : null}
      {loaderData.incidents.map((incident) => (
        <OwnSiteIncident key={incident.id} incident={incident} />
      ))}
      <ChipFeed
        groups={loaderData.groups}
        counts={loaderData.chipCounts}
        hiringCapped={loaderData.hiringCapped}
        hasOpenIncident={loaderData.openIncident !== null}
      />
      <AlertsFoot offLine={loaderData.offLine} />
    </main>
  );
}
