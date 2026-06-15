import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { LinksFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Current public launch status for Five to Nine health, search, billing, delivery, and manual blockers.";

export const links: LinksFunction = () => canonicalLinks("/status");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Status | Five to Nine",
    description,
    pathname: "/status",
  });

export async function loader({ context }: LoaderFunctionArgs) {
  const cloudflare = context.cloudflare as { env?: unknown } | undefined;
  return {
    generatedAt: new Date().toISOString(),
    appServed: Boolean(cloudflare?.env),
  };
}

export default function StatusRoute() {
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

      <PublicDocBlock title="Launch blockers">
        <ul className="f9-doc-list">
          <li>Slack broad-launch proof still requires one real configured Slack target and a recent successful Slack delivery.</li>
          <li>WhatsApp is not launch-scoped until provider, customer enablement, templates, webhook, and delivered proof are ready.</li>
          <li>Dodo portal subscription updates need the dashboard setting confirmed by Nish.</li>
          <li>External uptime monitoring still needs a third-party monitor pointed at `https://0509.io/api/health`.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Safety controls">
        <ul className="f9-doc-list">
          <li>Authentication, writes, public API reads, public search, and account search are rate limited.</li>
          <li>Plans have watchlist, board, digest, proof-capture, and team-seat caps.</li>
          <li>Proof usage warns after 80% and hard-stops when paid capacity is exhausted.</li>
          <li>Operator views and scheduled alerts track failed runs, proof failures, delivery failures, stale watchlists, and capacity risk.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
