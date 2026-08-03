import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { LinksFunction } from "react-router";
import { useLoaderData } from "react-router";

import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";

const description =
  "Configuration and scope information for Five to Nine; this page is not a live provider-health monitor.";

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

  return {
    generatedAt: new Date().toISOString(),
    appServed: Boolean(env),
    commercialLaunch: env ? publicCommercialLaunchSummary(env) : null,
  };
}

export default function StatusRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <PublicDocShell
      kicker="Status"
      title="Five to Nine service status."
      intro="This page provides configuration and scope information, not a live provider-health monitor. It does not measure live search, email, billing, or provider availability."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({ name: "Status | Five to Nine", description, pathname: "/status" }),
        )}
      />
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
