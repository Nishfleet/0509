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
            <dd>Secure email-link sign-in for saved competitors, boards, briefs, and reports.</dd>
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
            <dd>
              {data.commercialLaunch?.agencySaleOpen
                ? "Available for checkout"
                : "Held until monitoring fan-out is proven on the internal workspace"}
            </dd>
          </div>
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Limited today">
        <ul className="f9-doc-list">
          <li>Slack delivery is available in the product, but broad launch still needs fresh Slack proof.</li>
          <li>Dodo customer portal subscription changes still need dashboard confirmation.</li>
          <li>External uptime monitoring still needs to be connected to the public health endpoint.</li>
          <li>WhatsApp delivery is not launch-scoped yet. Use email or Slack for customer delivery.</li>
          <li>Plan changes, cancellation, deletion, and sensitive account changes are handled through support until portal changes are confirmed.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Safety controls">
        <ul className="f9-doc-list">
          <li>Sign-in, saved account data, search, and public pages are rate limited.</li>
          <li>Plans have watchlist, board, digest, proof-capture, and team-seat caps.</li>
          <li>Proof usage warns after 80% and hard-stops when paid capacity is exhausted.</li>
          <li>Support can review delivery failures, stale tracking, and capacity risk when something needs attention.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
