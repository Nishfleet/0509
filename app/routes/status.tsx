import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { LinksFunction } from "react-router";
import { useLoaderData } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { LocalTime } from "~/components/local-time";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Current public launch status for Five to Nine health, search, billing, delivery, and manual blockers.";
const PUBLIC_STATUS_EVIDENCE_CACHE_MS = 5 * 60 * 1000;
const PUBLIC_STATUS_EVIDENCE_ERROR_CACHE_MS = 30 * 1000;

let launchReadinessSignalsCache: {
  expiresAt: number;
  value: LaunchReadinessSignals | null;
} | null = null;

export const links: LinksFunction = () => canonicalLinks("/status");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Status | Five to Nine",
    description,
    pathname: "/status",
  });

export async function loader({ context }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const cloudflare = context.cloudflare as { env?: unknown } | undefined;
  const launchSignals = env.DB ? await readLaunchReadinessSignals(env) : null;

  return {
    generatedAt: new Date().toISOString(),
    appServed: Boolean(cloudflare?.env),
    evidence: launchSignals ? buildPublicStatusEvidence(launchSignals) : null,
    evidenceUnavailableReason: launchSignals ? null : "unavailable",
  };
}

export default function StatusRoute() {
  const data = useLoaderData<typeof loader>();
  const evidence = data?.evidence ?? null;
  const slackProofReady = evidence?.some((item) => item.id === "slack" && item.statusLabel === "Recent proof") ?? false;
  const whatsappProofReady =
    evidence?.some((item) => item.id === "whatsapp" && item.statusLabel === "Recent proof") ?? false;
  const launchBlockers = [
    ...(slackProofReady
      ? []
      : ["Slack broad-launch proof still requires one real configured Slack target and a recent successful Slack delivery."]),
    ...(whatsappProofReady
      ? []
      : ["WhatsApp is not launch-scoped until provider, customer enablement, templates, webhook, and delivered proof are ready."]),
    "Dodo portal subscription updates need the dashboard setting confirmed by Nish.",
    "External uptime monitoring still needs a third-party monitor pointed at `https://0509.io/api/health`.",
  ];

  return (
    <PublicDocShell
      kicker="Status"
      title="Pilot-ready. Broad launch is still gated."
      intro="This page is public product truth, not a substitute for the private launch canaries or an external uptime monitor."
    >
      <PublicDocBlock title="Operational surfaces">
        <dl className="proof-trail-list">
          <div>
            <dt>Worker health</dt>
            <dd>`/api/health` is public and should return status `ok` from the same Cloudflare app.</dd>
          </div>
          <div>
            <dt>Live search</dt>
            <dd>Fresh live search is launch-gated by the private production canary.</dd>
          </div>
          <div>
            <dt>Billing</dt>
            <dd>Dodo checkout and signed webhook grants are covered by the private billing canary.</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>Digest and alert email uses Cloudflare Email Service through the `send_email` binding.</dd>
          </div>
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Recent production evidence">
        {evidence ? (
          <>
            <p className="f9-muted-copy">
              These checks use coarse aggregate production signals from the last 36 hours. They do not expose exact
              counts, exact timestamps, customer destinations, API keys, webhook URLs, or the private canary token.
            </p>
            <dl className="proof-trail-list">
              {evidence.map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>
                    <strong>{item.statusLabel}</strong>
                    {" · "}
                    {item.detail}
                    {item.timestampAt && item.timestampLabel ? (
                      <>
                        {" "}
                        {item.timestampLabel} <LocalTime iso={item.timestampAt} />.
                      </>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <div className="f9-message is-error">
            <p>
              Production evidence is unavailable from this environment. The private canaries remain the launch gate.
            </p>
          </div>
        )}
      </PublicDocBlock>

      <PublicDocBlock title="Launch blockers">
        <ul className="f9-doc-list">
          {launchBlockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Safety controls">
        <ul className="f9-doc-list">
          <li>Authentication, writes, public API reads, public search, public status evidence, and account search are rate limited.</li>
          <li>Plans have watchlist, board, digest, proof-capture, and team-seat caps.</li>
          <li>Proof usage warns after 80% and hard-stops when paid capacity is exhausted.</li>
          <li>Operator views and scheduled alerts track failed runs, proof failures, delivery failures, stale watchlists, and capacity risk.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}

type LaunchReadinessSignals = Awaited<ReturnType<typeof import("~/lib/data.server").getLaunchReadinessSignals>>;

type PublicStatusEvidence = {
  id: string;
  label: string;
  statusLabel: string;
  detail: string;
  timestampLabel: string | null;
  timestampAt: string | null;
};

async function readLaunchReadinessSignals(env: unknown) {
  const now = Date.now();
  if (launchReadinessSignalsCache && launchReadinessSignalsCache.expiresAt > now) {
    return launchReadinessSignalsCache.value;
  }

  try {
    const { getLaunchReadinessSignals } = await import("~/lib/data.server");
    const value = await getLaunchReadinessSignals(env as Parameters<typeof getLaunchReadinessSignals>[0]);
    launchReadinessSignalsCache = {
      expiresAt: now + PUBLIC_STATUS_EVIDENCE_CACHE_MS,
      value,
    };
    return value;
  } catch {
    launchReadinessSignalsCache = {
      expiresAt: now + PUBLIC_STATUS_EVIDENCE_ERROR_CACHE_MS,
      value: null,
    };
    return null;
  }
}

function buildPublicStatusEvidence(signals: LaunchReadinessSignals): PublicStatusEvidence[] {
  const whatsappLaunchScoped = isWhatsAppLaunchScoped(signals.whatsappDelivery);
  const whatsappProofReady = isWhatsAppProofReady(signals.whatsappDelivery);

  return [
    {
      id: "monitoring",
      label: "Monitoring run",
      statusLabel: signals.monitoring.recentSuccessfulRuns > 0 ? "Recent proof" : "Needs proof",
      detail:
        signals.monitoring.recentSuccessfulRuns > 0
          ? "Recent successful monitoring proof is visible in private launch checks."
          : "No recent successful monitoring run is visible yet.",
      timestampLabel: null,
      timestampAt: null,
    },
    {
      id: "proof",
      label: "Proof capture",
      statusLabel: signals.proof.recentSuccessfulCaptures > 0 ? "Recent proof" : "Needs proof",
      detail:
        signals.proof.recentSuccessfulCaptures > 0
          ? "Recent proof capture is visible in private launch checks."
          : "No recent successful proof capture is visible yet.",
      timestampLabel: null,
      timestampAt: null,
    },
    {
      id: "digest",
      label: "Digest delivery",
      statusLabel: signals.digestDelivery.recentSent > 0 ? "Recent proof" : "Needs proof",
      detail:
        signals.digestDelivery.recentSent > 0
          ? "Recent digest delivery proof is visible in private launch checks."
          : "No recent digest delivery proof is visible yet.",
      timestampLabel: null,
      timestampAt: null,
    },
    {
      id: "slack",
      label: "Slack delivery",
      statusLabel: signals.slackDelivery.usableTargets > 0 && signals.slackDelivery.recentSent > 0
        ? "Recent proof"
        : "Launch blocker",
      detail:
        signals.slackDelivery.usableTargets > 0 && signals.slackDelivery.recentSent > 0
          ? "Recent Slack delivery proof is visible in private launch checks."
          : "Slack broad launch still needs a configured target and recent successful delivery proof.",
      timestampLabel: null,
      timestampAt: null,
    },
    {
      id: "whatsapp",
      label: "WhatsApp delivery",
      statusLabel: whatsappProofReady ? "Recent proof" : whatsappLaunchScoped ? "Launch blocker" : "Not launch-scoped",
      detail: whatsappProofReady
        ? "Recent WhatsApp customer delivery proof is visible in private launch checks."
        : whatsappLaunchScoped
          ? "WhatsApp has partial readiness or delivery history, but provider, customer lane, webhook, usable target, and delivered proof are not all ready."
          : "Provider, customer lane, webhook, and delivered proof are not all enabled, so WhatsApp stays out of launch claims.",
      timestampLabel: null,
      timestampAt: null,
    },
  ];
}

function isWhatsAppLaunchScoped(input: LaunchReadinessSignals["whatsappDelivery"]) {
  return (
    input.providerConfigured ||
    input.customerReady ||
    input.webhookConfigured ||
    input.usableTargets > 0 ||
    input.recentAttempts > 0 ||
    input.recentSent > 0
  );
}

function isWhatsAppProofReady(input: LaunchReadinessSignals["whatsappDelivery"]) {
  return (
    input.providerConfigured &&
    input.customerReady &&
    input.webhookConfigured &&
    input.usableTargets > 0 &&
    input.recentSent > 0
  );
}
