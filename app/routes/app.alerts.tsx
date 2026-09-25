import type { Route } from "./+types/app.alerts";

import { AlertFeed } from "../components/alert-feed";
import { PAGE, PageHeading } from "../components/page-heading";
import { SourcePill } from "../components/source-pill";
import { loadAlertsPage } from "../lib/alerts-page.server";
import { requireSession } from "../lib/require-session.server";

const WHEN_CLASS = "text-ink-soft mt-2 block font-mono text-[0.75rem] tracking-[0.04em] uppercase";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  return loadAlertsPage(session.user.id);
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
      <AlertFeed groups={loaderData.groups} />
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
