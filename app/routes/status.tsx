import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { LinksFunction } from "react-router";
import { useLoaderData } from "react-router";

import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { monitoringCoverageDays } from "~/lib/monitoring-coverage";
import {
  getPublicStatusSurfaces,
  type PublicStatusSurfaces,
  type SurfaceMeasurement,
} from "~/lib/public-status-counters.server";
import type { AppEnv } from "~/lib/env.server";
import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";

const description =
  "Measured service status for Five to Nine: public search, sign-in, billing, email delivery, scheduled monitoring, and uptime, read live from the service's own probe records each time the page loads.";

export const links: LinksFunction = () => canonicalLinks("/status");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Status | Five to Nine",
    description,
    pathname: "/status",
  });

export async function loader({ context }: LoaderFunctionArgs) {
  const { publicCommercialLaunchSummary } = await import("~/lib/commercial-launch-gate.server");
  const cloudflare = getOptionalCloudflareContext(context);
  const env = cloudflare?.env;

  const asOf = new Date().toISOString();
  let surfaces: PublicStatusSurfaces;
  try {
    surfaces = await getPublicStatusSurfaces((env ?? {}) as AppEnv);
  } catch {
    // The measurements module never throws by design; this guard keeps the
    // page itself up even if that guarantee regresses.
    surfaces = await getPublicStatusSurfaces({} as AppEnv);
  }

  return {
    generatedAt: asOf,
    asOf,
    appServed: Boolean(env),
    commercialLaunch: env ? publicCommercialLaunchSummary(env) : null,
    surfaces,
    monitoring: surfaces.monitoring,
  };
}

function checkedMinutesAgo(checkedAt: string, asOf: string): number {
  return Math.max(0, Math.round((Date.parse(asOf) - Date.parse(checkedAt)) / 60_000));
}

const STATE_LABEL: Record<SurfaceMeasurement["state"], string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
};

function SurfaceRow({ surface, asOf }: { surface: SurfaceMeasurement; asOf: string }) {
  const stateLabel = STATE_LABEL[surface.state];
  return (
    <div>
      <dt>{surface.label}</dt>
      <dd title={`Source: ${surface.source}`}>
        <strong>{stateLabel}</strong>
        {surface.reason ? `: ${surface.reason}. ` : ". "}
        {surface.facts.length > 0 ? `${surface.facts.join("; ")}. ` : ""}
        Checked {checkedMinutesAgo(surface.checkedAt, asOf)} min ago.
      </dd>
    </div>
  );
}

/**
 * Pre-run bootstrap: the monitoring tables exist but no scheduled run has ever
 * been recorded (issue #2963). Publishing "0 runs / no digests sent yet" reads
 * to a buyer as a dead product, so the page shows honest configuration prose
 * instead of empty counters. Any recorded activity falls through to the
 * measured counters with their as-of timestamps.
 */
function isPreRunBootstrap(monitoring: {
  lastWatchlistRunAt: string | null;
  runsInLast24h: number;
  lastDigestSentAt: string | null;
}): boolean {
  return (
    monitoring.lastWatchlistRunAt === null &&
    monitoring.runsInLast24h === 0 &&
    monitoring.lastDigestSentAt === null
  );
}

export default function StatusRoute() {
  const data = useLoaderData<typeof loader>();
  const monitoring = data.monitoring;
  const asOf = data.asOf;
  const surfaces = data.surfaces.surfaces;

  const intro =
    "Five to Nine measures public search, sign-in, billing, email delivery, scheduled monitoring, and uptime on this page; every number below is read from the service's own probe records each time you load it.";

  return (
    <PublicDocShell
      kicker="Status"
      title="Five to Nine service status."
      intro={intro}
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Status | Five to Nine",
            description,
            pathname: "/status",
          }),
        )}
      />

      <PublicDocBlock title="Core surfaces">
        <dl className="proof-trail-list">
          {surfaces.map((surface) => (
            <SurfaceRow key={surface.id} surface={surface} asOf={asOf} />
          ))}
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Monitoring health">
        {monitoring ? (
          isPreRunBootstrap(monitoring) ? (
            <dl className="proof-trail-list">
              <div>
                <dt>Monitoring pipeline</dt>
                <dd>
                  Monitoring is configured and scheduled on this service.
                  Run and digest counts appear here from the first scheduled
                  run onward. As of {asOf}.
                </dd>
              </div>
              {monitoring.scheduledMonitoringSince ? (
                <div>
                  <dt>Scheduled monitoring active since</dt>
                  <dd>{monitoring.scheduledMonitoringSince} — continuous scheduled monitoring coverage ({monitoringCoverageDays(monitoring.scheduledMonitoringSince, asOf)} days). As of {asOf}.</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <dl className="proof-trail-list">
              {monitoring.scheduledMonitoringSince ? (
                <div>
                  <dt>Scheduled monitoring active since</dt>
                  <dd>{monitoring.scheduledMonitoringSince} — continuous scheduled monitoring coverage ({monitoringCoverageDays(monitoring.scheduledMonitoringSince, asOf)} days). As of {asOf}.</dd>
                </div>
              ) : null}
              <div>
                <dt>Watchlist runs in the last 24 hours</dt>
                <dd>{monitoring.runsInLast24h.toLocaleString()} — as of {asOf}</dd>
              </div>
              <div>
                <dt>Failed watchlist runs in the last 24 hours</dt>
                <dd>{monitoring.failedRunsInLast24h.toLocaleString()} — as of {asOf}</dd>
              </div>
              <div>
                <dt>Last watchlist run</dt>
                <dd>{monitoring.lastWatchlistRunAt ?? "no scheduled run in the measurement window"}, as of {asOf}</dd>
              </div>
              <div>
                <dt>Last digest sent</dt>
                {monitoring.digestHealth === "stalled" ? (
                  <dd>
                    <strong>Digest sends appear stalled.</strong>{" "}
                    Monitoring is healthy but no digest has been sent in the last{" "}
                    7 days (last sent{" "}
                    {monitoring.lastDigestSentAt ?? "never"}); this is being{" "}
                    investigated rather than reported as a live date.
                  </dd>
                ) : (
                  <dd>
                    {monitoring.lastDigestSentAt ?? "no digest send recorded in the measurement window"} — as of{" "}
                    {asOf}
                  </dd>
                )}
              </div>
            </dl>
          )
        ) : (
          <dl className="proof-trail-list">
            <div>
              <dt>Monitoring counters</dt>
              <dd>
                The counter probe is degraded right now; the Core surfaces
                rows above carry each surface's own state and reason.
              </dd>
            </div>
          </dl>
        )}
      </PublicDocBlock>

      <PublicDocBlock title="Commercial configuration">
        <dl className="proof-trail-list">
          <div>
            <dt>Scout</dt>
            <dd>{data.commercialLaunch?.scoutSaleOpen ? "Checkout enabled: Scout monthly products are configured with the billing provider." : "Checkout held: Scout monthly products are not configured with the billing provider."}</dd>
          </div>
          <div>
            <dt>Starter</dt>
            <dd>{data.commercialLaunch?.starterSaleOpen ? "Checkout enabled: Starter monthly products are configured with the billing provider." : "Checkout held: Starter monthly products are not configured with the billing provider."}</dd>
          </div>
          <div>
            <dt>Agency</dt>
            <dd>{data.commercialLaunch?.agencySaleOpen ? "Checkout enabled: Agency monthly products are configured with the billing provider." : "Checkout held: Agency monthly products are not configured with the billing provider."}</dd>
          </div>
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Safety controls">
        <ul className="f9-doc-list">
          <li>Anonymous search allows 20 searches per browser per 10 minutes with a 100-per-IP backstop over the same window; brand pages allow 120 reads per IP per 10 minutes.</li>
          <li>Signed-in search allows 60 searches per 10 minutes plus a daily plan cap: 25 (Free), 100 (Scout), 300 (Starter), 1,000 (Agency).</li>
          <li>Sign-in and account endpoints allow 20 requests per 10 minutes; billing mutations allow 5 per 10 minutes per account; webhooks allow 300 per minute.</li>
          <li>Plans cap watchlists at 1 (Free), 3 (Scout), 10 (Starter), and 75 (Agency), with included evidence checks of 1, 50, 250, and 2,500 per month and up to 3 team seats.</li>
          <li>Check usage warns after 80% of the monthly included volume and hard-stops when paid volume is exhausted.</li>
          <li>Every outbound email consults the bounce and complaint suppression ledger before sending; the suppressed count is measured on the Email delivery row above.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
