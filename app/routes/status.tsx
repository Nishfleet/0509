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
import { presenceSourceCoverageForDocs } from "~/lib/presence-source-coverage.server";
import type { AppEnv } from "~/lib/env.server";
import type { GoogleAdsCaptureStats } from "~/lib/sources/google-ads/google-ads-usage.server";
import type { LinkedInAdsCaptureStats } from "~/lib/sources/linkedin-ads/linkedin-ads-usage.server";
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

  // Google Ads (Transparency Center) capture facts (issue #3197). The kill
  // flag posture is configuration, always known when the app is served; the
  // 24h attempt/failure counters read the #2181 seam KV namespace and are
  // omitted when that binding is not wired (missing = no false claim, the
  // #2200 rule). Guarded like every read on this page.
  let googleAdsCaptures: GoogleAdsCaptureStats | null = null;
  let googleAdsSourceKilled = false;
  if (env) {
    const { getGoogleAdsCaptureStats24h } = await import(
      "~/lib/sources/google-ads/google-ads-usage.server"
    );
    const { isGoogleAdsSourceKilled } = await import("~/lib/env.server");
    googleAdsSourceKilled = isGoogleAdsSourceKilled(env as AppEnv);
    try {
      googleAdsCaptures = await getGoogleAdsCaptureStats24h(env as AppEnv);
    } catch {
      googleAdsCaptures = null;
    }
  }

  // LinkedIn Ads (Ad Library) capture facts (issue #3196) — the #3197
  // Google Ads facts' shape: the kill flag posture is configuration, always
  // known when the app is served; the 24h attempt/failure counters read the
  // #2181 seam KV namespace and are omitted when that binding is not wired
  // (missing = no false claim, the #2200 rule). Guarded like every read on
  // this page.
  let linkedinAdsCaptures: LinkedInAdsCaptureStats | null = null;
  let linkedinAdsSourceKilled = false;
  if (env) {
    const { getLinkedInAdsCaptureStats24h } = await import(
      "~/lib/sources/linkedin-ads/linkedin-ads-usage.server"
    );
    const { isLinkedInAdsSourceKilled } = await import("~/lib/env.server");
    linkedinAdsSourceKilled = isLinkedInAdsSourceKilled(env as AppEnv);
    try {
      linkedinAdsCaptures = await getLinkedInAdsCaptureStats24h(env as AppEnv);
    } catch {
      linkedinAdsCaptures = null;
    }
  }

  return {
    generatedAt: asOf,
    asOf,
    appServed: Boolean(env),
    commercialLaunch: env ? publicCommercialLaunchSummary(env) : null,
    surfaces,
    // The tracked-source catalog: every mention source with its honest
    // activation posture, straight from the coverage module (issue #3205).
    // Pure, environment-free: no probe, no D1, cannot throw.
    mentionSources: presenceSourceCoverageForDocs(),
    monitoring: surfaces.monitoring,
    googleAdsCaptures,
    googleAdsSourceKilled,
    linkedinAdsCaptures,
    linkedinAdsSourceKilled,
  };
}

/**
 * The one factual sentence for the /status Google Ads capture row (issue
 * #3197): the kill flag posture, plus the 24h attempt/failure numbers when
 * the #2181 KV binding carries them. Killed skips the counters on purpose —
 * a deliberately paused source has no meaningful failure rate, and a 0/0
 * day rendered as 0% would hide that. The window is the union of today's and
 * yesterday's UTC day counters, which the wording states instead of faking a
 * rolling 24h. Counter facts degrade to the flag posture when the binding is
 * not wired — nothing here is invented.
 */
export function googleAdsCaptureLine(
  captures: GoogleAdsCaptureStats | null | undefined,
  killed: boolean,
): string {
  if (killed) {
    return "Source paused by its kill flag GOOGLE_ADS_SOURCE_DISABLED=1 — scheduled captures, the /ads section and coverage reporting follow it. ";
  }
  const flag = "Source enabled (kill flag GOOGLE_ADS_SOURCE_DISABLED=0). ";
  if (captures?.counted) {
    const rateTail =
      captures.rate !== null
        ? ` — ${Math.round(captures.rate * 100)}% capture failure rate`
        : "";
    return `${flag}${captures.attempted} capture attempts in the last two UTC days, ${captures.failed} failed${rateTail} (best-effort counter). `;
  }
  return `${flag}Capture failure counters report once the seam's KV namespace (DECODO_BUDGET) is wired on this deployment. `;
}

/**
 * The one factual sentence for the /status LinkedIn Ads (Ad Library) capture
 * row (issue #3196) — the #3197 Google Ads line's shape with the LinkedIn
 * flag's name: the kill-flag posture, plus the 24h attempt/failure numbers
 * when the #2181 KV binding carries them. Killed skips the counters on
 * purpose — a deliberately paused source has no meaningful failure rate, and
 * a 0/0 day rendered as 0% would hide that. The window is the union of
 * today's and yesterday's UTC day counters, which the wording states instead
 * of faking a rolling 24h. Counter facts degrade to the flag posture when
 * the binding is not wired — nothing here is invented.
 */
export function linkedinAdsCaptureLine(
  captures: LinkedInAdsCaptureStats | null | undefined,
  killed: boolean,
): string {
  if (killed) {
    return "Source paused by its kill flag LINKEDIN_ADS_SOURCE_DISABLED=1 — scheduled captures and the /ads section follow it. ";
  }
  const flag = "Source enabled (kill flag LINKEDIN_ADS_SOURCE_DISABLED=0). ";
  if (captures?.counted) {
    const rateTail =
      captures.rate !== null
        ? ` — ${Math.round(captures.rate * 100)}% capture failure rate`
        : "";
    return `${flag}${captures.attempted} capture attempts in the last two UTC days, ${captures.failed} failed${rateTail} (best-effort counter). `;
  }
  return `${flag}Capture failure counters report once the seam's KV namespace (DECODO_BUDGET) is wired on this deployment. `;
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

        {data.googleAdsCaptures || data.googleAdsSourceKilled ? (
          <dl className="proof-trail-list">
            <div>
              <dt>Google Ads (Transparency Center) capture</dt>
              <dd>
                {googleAdsCaptureLine(data.googleAdsCaptures, data.googleAdsSourceKilled)}
                As of {asOf}.
              </dd>
            </div>
          </dl>
        ) : null}

        {data.linkedinAdsCaptures || data.linkedinAdsSourceKilled ? (
          <dl className="proof-trail-list">
            <div>
              <dt>LinkedIn Ads (Ad Library) capture</dt>
              <dd>
                {linkedinAdsCaptureLine(data.linkedinAdsCaptures, data.linkedinAdsSourceKilled)}
                As of {asOf}.
              </dd>
            </div>
          </dl>
        ) : null}
      </PublicDocBlock>

      <PublicDocBlock title="Tracked sources">
        <p>
          Every tracked mention arrives through one of the sources below, and
          each row's posture comes straight from the source catalog in code —
          active = capturing; gated = wired in, waiting on its rollout
          decision; every other posture's note says what it waits on.
        </p>
        <dl className="proof-trail-list">
          {(data.mentionSources ?? []).map((source) => (
            <div key={source.sourceId}>
              <dt>{source.label}</dt>
              <dd>
                <strong>{source.productionStatus}</strong>
                {`. ${source.notes}`}
              </dd>
            </div>
          ))}
        </dl>
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
