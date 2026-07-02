import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { LinksFunction } from "react-router";
import { useLoaderData } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Current service status and launch posture for Five to Nine search, accounts, billing, and delivery.";

export const links: LinksFunction = () => canonicalLinks("/status");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Status | Five to Nine",
    description,
    pathname: "/status",
  });

export async function loader({ context }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { summarizeCommercialLaunch } = await import("~/lib/commercial-launch-gate.server");
  const cloudflare = context.cloudflare as { env?: unknown } | undefined;
  const env = cloudflare?.env as import("~/lib/env.server").AppEnv | undefined;

  return {
    generatedAt: new Date().toISOString(),
    appServed: Boolean(cloudflare?.env),
    commercialLaunch: env ? summarizeCommercialLaunch(env) : null,
    evidence: null,
    evidenceUnavailableReason: "private_canary_only",
  };
}

export default function StatusRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <PublicDocShell
      kicker="Status"
      title="Five to Nine service status."
      intro="A plain view of what is available today, what is intentionally limited, and what still blocks broad launch."
    >
      <PublicDocBlock title="Core surfaces">
        <dl className="proof-trail-list">
          <div>
            <dt>Public search</dt>
            <dd>Available for checking competitor ads from a website.</dd>
          </div>
          <div>
            <dt>Accounts</dt>
            <dd>Secure email-link sign-in for saved competitors, collections, digests, and reports.</dd>
          </div>
          <div>
            <dt>Billing</dt>
            <dd>Checkout, receipts, invoices, and billing support are available for paid plans.</dd>
          </div>
          <div>
            <dt>Email delivery</dt>
            <dd>Digest and alert emails are available for eligible accounts.</dd>
          </div>
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Commercial availability">
        <dl className="proof-trail-list">
          <div>
            <dt>Scout</dt>
            <dd>{data.commercialLaunch?.scoutSaleOpen ? "Available for checkout" : "Held — billing configuration"}</dd>
          </div>
          <div>
            <dt>Starter</dt>
            <dd>{data.commercialLaunch?.starterSaleOpen ? "Available for checkout" : "Held — billing configuration"}</dd>
          </div>
          <div>
            <dt>Agency</dt>
            <dd>{data.commercialLaunch?.agencySaleOpen ? "Available for checkout" : "Held while we finish proving nightly monitoring capacity at scale"}</dd>
          </div>
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Limited today">
        <ul className="f9-doc-list">
          <li>Email delivery is available for eligible accounts; delivery issues can be reviewed through support.</li>
          <li>Dodo-backed plan switching is repo-configured for linked paid subscriptions; support handles changes until internal smoke proof is complete.</li>
          <li>Recurring uptime checks are configured; first alert proof is still operator-verified.</li>
          <li>Cancellation, deletion, and sensitive account changes still use the hosted portal or support path.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Safety controls">
        <ul className="f9-doc-list">
          <li>Sign-in, saved account data, search, and public pages are rate limited.</li>
          <li>Plans have watchlist, collection, digest, proof-capture, and team-seat caps.</li>
          <li>Proof usage warns after 80% and hard-stops when paid capacity is exhausted.</li>
          <li>Support can review delivery failures, stale tracking, and capacity risk when something needs attention.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
