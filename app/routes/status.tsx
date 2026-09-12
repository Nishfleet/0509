import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { LinksFunction } from "react-router";
import { useLoaderData } from "react-router";

import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { getPublicStatusCounters } from "~/lib/public-status-counters.server";
import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";

import "~/styles/marketing.css";
const description =
  "Configuration and scope information and live monitoring facts for Five to Nine; this page does not measure live search, email, billing, or provider availability.";

const degradedDescription =
  "Configuration and scope information for Five to Nine. Live monitoring facts are unavailable right now; this page does not measure live search, email, billing, or provider availability.";

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

/**
 * Continuous scheduled-monitoring coverage: whole days between the earliest
 * activation baseline and the as-of instant. A truthful figure derived from
 * real schedule data, not a fabricated uptime percentage.
 */
function coverageDays(sinceIso: string | null, asOfIso: string): number | null {
  if (!sinceIso) return null;
  const since = new Date(sinceIso).getTime();
  const asOf = new Date(asOfIso).getTime();
  if (!Number.isFinite(since) || !Number.isFinite(asOf) || asOf < since) return null;
  return Math.floor((asOf - since) / (24 * 60 * 60 * 1000));
}

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
  let counters = null;
  let measurementsUnavailable = !env;
  if (env) {
    try {
      counters = await getPublicStatusCounters(env);
    } catch {
      counters = null;
      measurementsUnavailable = true;
    }
  }

  return {
    generatedAt: asOf,
    asOf,
    appServed: Boolean(env),
    commercialLaunch: env ? publicCommercialLaunchSummary(env) : null,
    monitoring: counters,
    measurementsUnavailable,
  };
}

export default function StatusRoute() {
  const data = useLoaderData<typeof loader>();
  const monitoring = data.monitoring;
  const asOf = data.asOf;
  const measurementsUnavailable = data.measurementsUnavailable;

  const intro = measurementsUnavailable
    ? "Configuration and scope information for Five to Nine. Live monitoring facts are unavailable right now; this page does not measure live search, email, billing, or provider availability."
    : "Configuration and scope information and live monitoring facts for Five to Nine; this page does not measure live search, email, billing, or provider availability.";

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
            description: measurementsUnavailable ? degradedDescription : description,
            pathname: "/status",
          }),
        )}
      />

      <PublicDocBlock title="Monitoring health">
        {monitoring ? (
          isPreRunBootstrap(monitoring) ? (
            <dl className="proof-trail-list">
              <div>
                <dt>Monitoring pipeline</dt>
                <dd>
                  Monitoring is configured and scheduled on this service.
                  Aggregate run and digest counts will appear here after the
                  first scheduled run is recorded; until then there is no
                  historical activity to display. As of {asOf}.
                </dd>
              </div>
              {monitoring.scheduledMonitoringSince ? (
                <div>
                  <dt>Scheduled monitoring active since</dt>
                  <dd>{monitoring.scheduledMonitoringSince} — continuous scheduled monitoring coverage ({coverageDays(monitoring.scheduledMonitoringSince, asOf)} days). As of {asOf}.</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <dl className="proof-trail-list">
              {monitoring.scheduledMonitoringSince ? (
                <div>
                  <dt>Scheduled monitoring active since</dt>
                  <dd>{monitoring.scheduledMonitoringSince} — continuous scheduled monitoring coverage ({coverageDays(monitoring.scheduledMonitoringSince, asOf)} days). As of {asOf}.</dd>
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
                <dd>{monitoring.lastWatchlistRunAt ?? "no recent scheduled runs in the measurement window"} — as of {asOf}</dd>
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
            <p>Measurements unavailable right now.</p>
          </dl>
        )}
      </PublicDocBlock>

      <PublicDocBlock title="Core surfaces">
        <dl className="proof-trail-list">
          <div>
            <dt>Public search</dt>
            <dd>Free competitor ad search that runs without an account, rate limited to keep it fair.</dd>
          </div>
          <div>
            <dt>Accounts</dt>
            <dd>Sign-in is a secure one-time email link — no passwords are stored.</dd>
          </div>
          <div>
            <dt>Billing</dt>
            <dd>Checkout and plan changes run through Dodo Payments in your local currency.</dd>
          </div>
          <div>
            <dt>Email delivery</dt>
            <dd>Change alerts and digests are sent by email through Cloudflare Email Service.</dd>
          </div>
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Commercial configuration">
        <dl className="proof-trail-list">
          <div>
            <dt>Scout</dt>
            <dd>{data.commercialLaunch?.scoutSaleOpen ? "Configured for checkout (not live-checked)" : "Held — billing configuration"}</dd>
          </div>
          <div>
            <dt>Starter</dt>
            <dd>{data.commercialLaunch?.starterSaleOpen ? "Configured for checkout (not live-checked)" : "Held — billing configuration"}</dd>
          </div>
          <div>
            <dt>Agency</dt>
            <dd>{data.commercialLaunch?.agencySaleOpen ? "Configured for account review (not live-checked)" : "Held — account configuration"}</dd>
          </div>
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Limited today">
        <ul className="f9-doc-list">
          <li>Email delivery configuration and eligible-account scope can be reviewed through support; delivery is not measured here.</li>
          <li>Dodo-backed plan switching is configured for linked paid subscriptions; this page does not report live billing-provider health.</li>
          <li>Recurring uptime checks are configured and reviewed by the operator; this public page is not a live uptime monitor.</li>
          <li>Cancellation, deletion, and sensitive account changes still use the hosted portal or support path.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Safety controls">
        <ul className="f9-doc-list">
          <li>Sign-in, saved account data, search, and public pages are rate limited.</li>
          <li>Plans have watchlist, collection, digest, check, and team-seat caps.</li>
          <li>Check usage warns after 80% and hard-stops when paid volume is exhausted.</li>
          <li>Support can review delivery failures, stale tracking, and account-volume risk when something needs attention.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
