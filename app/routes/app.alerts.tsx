import type { Route } from "./+types/app.alerts";
import { env } from "cloudflare:workers";

import { readDeliveryFailures, readOwnSiteIncidents, readTakedownNotes } from "../lib/data/alert.server";
import { readWorkspaceIdForOwner } from "../lib/data/workspace.server";
import { daysAgoLabel } from "../lib/delivery-alert";
import { requireSession } from "../lib/require-session.server";
import { daysBefore, readSiteChangeViews } from "../lib/site-changes.server";
import { BriefView } from "../components/brief-view";
import { SiteChangeItem } from "../components/site-change-item";

const WHEN_CLASS = "text-ink-soft mt-2 block font-mono text-[0.75rem] tracking-[0.04em] uppercase";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const failures = workspaceId === null ? [] : await readDeliveryFailures(env.DB, workspaceId);
  const notes = workspaceId === null ? [] : await readTakedownNotes(env.DB, workspaceId);
  const incidents = workspaceId === null ? [] : await readOwnSiteIncidents(env.DB, workspaceId);
  const now = new Date();
  const changes =
    workspaceId === null
      ? []
      : await readSiteChangeViews({ workspaceId, entityId: null, since: daysBefore(now, 30), limit: 30 });
  return {
    email: session.user.email,
    incidents: incidents.map((incident) => ({
      ...incident,
      when: daysAgoLabel(incident.created_at, now),
      fixed: incident.closed_at === null ? null : daysAgoLabel(incident.closed_at, now),
    })),
    changes: changes.map((change) => ({ ...change, when: daysAgoLabel(change.observedAt, now) })),
    failures: failures.map((failure) => ({ ...failure, when: daysAgoLabel(failure.created_at, now) })),
    notes: notes.map((note) => ({ ...note, when: daysAgoLabel(note.created_at, now) })),
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">Alerts</h1>
      <p className="text-ink-soft mt-2 leading-[1.65]">Signed in as {loaderData.email}</p>
      {loaderData.failures.length === 0 &&
      loaderData.notes.length === 0 &&
      loaderData.incidents.length === 0 &&
      loaderData.changes.length === 0 ? (
        <p className="mt-8 leading-[1.65]">
          Nothing has interrupted you. When your own site breaks you'll get an email; everything else waits here.
        </p>
      ) : null}
      {loaderData.incidents.map((incident) => (
        <article
          key={incident.id}
          id={incident.id}
          data-testid="own-site-incident"
          className="border-line mt-8 border-t pt-6"
        >
          <h2 className="font-display text-lg font-semibold">{incident.title}</h2>
          <p className="mt-2 leading-[1.65]">
            {incident.fixed === null
              ? "We check it again every hour and email you once it's fixed."
              : `Fixed ${incident.fixed}.`}
          </p>
          <time dateTime={incident.created_at} className={WHEN_CLASS}>
            {incident.when}
          </time>
        </article>
      ))}
      {loaderData.changes.map((change, index) => (
        <SiteChangeItem key={change.id} change={change} eager={index === 0} />
      ))}
      {loaderData.notes.map((note) => (
        <article
          key={note.id}
          id={note.id}
          data-testid="takedown-note"
          className="border-line mt-8 border-t pt-6"
        >
          <p className="leading-[1.65]">{note.title}</p>
          <time dateTime={note.created_at} className={WHEN_CLASS}>
            {note.when}
          </time>
        </article>
      ))}
      {loaderData.failures.map((failure) => (
        <article
          key={failure.id}
          id={failure.id}
          data-testid="delivery-failure"
          className="border-line mt-8 border-t pt-6"
        >
          <h2 className="font-display text-lg font-semibold">{failure.title}</h2>
          <p className="mt-2 leading-[1.65]">{failure.body}</p>
          <time dateTime={failure.created_at} className={WHEN_CLASS}>
            {failure.when}
          </time>
          {failure.brief === null ? null : (
            <details className="mt-4">
              <summary className="cursor-pointer underline decoration-1 underline-offset-4">
                Read the brief
              </summary>
              <div className="mt-4">
                <BriefView payload={failure.brief} />
              </div>
            </details>
          )}
        </article>
      ))}
    </main>
  );
}
