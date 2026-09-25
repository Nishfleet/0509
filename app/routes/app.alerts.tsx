import type { Route } from "./+types/app.alerts";
import { env } from "cloudflare:workers";

import {
  readDeliveryFailures,
  readOwnSiteIncidents,
  readSignalAlerts,
  readTakedownNotes,
} from "../lib/data/alert.server";
import { readCompetitors } from "../lib/data/entity.server";
import { readWorkspaceMentionSources } from "../lib/data/source.server";
import { readWorkspaceIdForOwner, readWorkspaceTimezone } from "../lib/data/workspace.server";
import { daysAgoLabel } from "../lib/delivery-alert";
import { offBrandsSentence } from "../lib/off-brands";
import { requireSession } from "../lib/require-session.server";
import { daysBefore, readSiteChangeViews } from "../lib/site-changes.server";
import { groupByDay } from "../lib/alert-day";
import {
  AlertFeedRow,
  type AlertFeedItem,
  type DeliveryFailureItem,
  type SignalAlertItem,
  type TakedownNoteItem,
} from "../components/alert-row";
import { PAGE, PageHeading } from "../components/page-heading";
import { SourcePill } from "../components/source-pill";

const WHEN_CLASS = "text-ink-soft mt-2 block font-mono text-[0.75rem] tracking-[0.04em] uppercase";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const workspaceId = await readWorkspaceIdForOwner(session.user.id);
  const competitors = workspaceId === null ? [] : (await readCompetitors(workspaceId)).competitors;
  const failures = workspaceId === null ? [] : await readDeliveryFailures(env.DB, workspaceId);
  const notes = workspaceId === null ? [] : await readTakedownNotes(env.DB, workspaceId);
  const incidents = workspaceId === null ? [] : await readOwnSiteIncidents(env.DB, workspaceId);
  const signals = workspaceId === null ? [] : await readSignalAlerts(env.DB, workspaceId);
  const sources = workspaceId === null ? [] : await readWorkspaceMentionSources(workspaceId);
  const now = new Date();
  const changes =
    workspaceId === null
      ? []
      : await readSiteChangeViews({ workspaceId, entityId: null, since: daysBefore(now, 30), limit: 30 });
  const timeZone = workspaceId === null ? "UTC" : await readWorkspaceTimezone(workspaceId);
  const items: AlertFeedItem[] = [
    ...changes.map((change) => ({
      kind: "change" as const,
      id: change.id,
      at: change.observedAt,
      change: { ...change, when: daysAgoLabel(change.observedAt, now) },
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      id: note.id,
      at: note.created_at,
      note: { ...note, when: daysAgoLabel(note.created_at, now) } satisfies TakedownNoteItem,
    })),
    ...failures.map((failure) => ({
      kind: "failure" as const,
      id: failure.id,
      at: failure.created_at,
      failure: { ...failure, when: daysAgoLabel(failure.created_at, now) } satisfies DeliveryFailureItem,
    })),
    ...signals.map((signal) => ({
      kind: "signal" as const,
      id: signal.id,
      at: signal.created_at,
      signal: { ...signal, when: daysAgoLabel(signal.created_at, now) } satisfies SignalAlertItem,
    })),
  ];
  return {
    incidents: incidents.map((incident) => ({
      ...incident,
      when: daysAgoLabel(incident.created_at, now),
      fixed: incident.closed_at === null ? null : daysAgoLabel(incident.closed_at, now),
    })),
    groups: groupByDay(items, now, timeZone),
    sources,
    now: now.getTime(),
    offLine: offBrandsSentence(
      competitors.filter((competitor) => competitor.state === "off").map((competitor) => competitor.name),
    ),
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <main className={PAGE}>
      <PageHeading title="Alerts" />
      <p data-testid="alerts-contract" className="text-ink-soft mt-2 leading-[1.65]">
        One thing here interrupted you by email: your own site.
      </p>
      {loaderData.sources.length > 0 ? (
        <p data-testid="alerts-sources" className="mt-4 flex flex-wrap gap-2">
          {loaderData.sources.map((entry) => (
            <SourcePill
              key={entry.source.key}
              source={entry.source}
              snapshot={entry.snapshot}
              now={loaderData.now}
            />
          ))}
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
      {loaderData.incidents.length === 0 && loaderData.groups.length === 0 ? (
        <p className="mt-8 leading-[1.65]">
          Nothing has interrupted you. When your own site breaks you'll get an email; everything else waits here.
        </p>
      ) : null}
      {loaderData.groups.map((group, groupIndex) => (
        <section key={group.group} data-testid="alert-day">
          <h2 className="text-ink-soft mt-10 font-mono text-[0.75rem] tracking-[0.04em] uppercase">
            {group.group}
          </h2>
          {group.items.map((item, index) => (
            <AlertFeedRow key={item.id} item={item} eager={groupIndex === 0 && index === 0} />
          ))}
        </section>
      ))}
      {loaderData.offLine === null ? null : (
        <p
          data-testid="alerts-off-footer"
          className="text-ink-soft border-line mt-10 border-t pt-6 leading-[1.65]"
        >
          {loaderData.offLine}
        </p>
      )}
    </main>
  );
}
