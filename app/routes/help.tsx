import { Link, useRouteLoaderData } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { CUSTOMER_SUPPORT_PATHS } from "~/lib/agent-action-catalog";
import { appLinkTarget } from "~/lib/app-link";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";
import type { RootLoaderData } from "~/root";

const description =
  "Help for setting up Five to Nine competitor monitoring, delivery, billing, and support.";

export const links: LinksFunction = () => canonicalLinks("/help");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Help | Five to Nine",
    description,
    pathname: "/help",
  });

export default function HelpRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData | undefined;
  const session = rootData?.session;

  return (
    <PublicDocShell
      kicker="Help"
      title="Get Five to Nine working for your team."
      intro="The fastest path is one competitor, one watchlist, one proof-backed change, then one delivery channel."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({ name: "Help | Five to Nine", description, pathname: "/help" }),
        )}
      />
      <PublicDocBlock title="Start here">
        <ol className="f9-numbered-guide">
          <li>Run a public search from the homepage or Search page.</li>
          <li>Create an account and add one competitor website.</li>
          <li>Open the watchlist and refresh tracking to save the first evidence trail.</li>
          <li>Review the digest page after the first monitored change or quiet check.</li>
        </ol>
        <p>
          Free lets you watch one competitor: an activation scan when you add it, then a weekly check with a weekly
          email brief. Paid plans add 3–6 hour checks, daily briefs, evidence, and more competitors, subject to the
          plan and account configuration. Proof captures are saved for each recorded change, with generous monthly
          caps and purchased proof-capture packs that never expire.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Delivery setup">
        <p>
          Email delivery is in product scope, but this page does not measure live email-provider availability. Paid
          plans add scheduled monitoring and digest features when configured for the account. Open{" "}
          <Link to={appLinkTarget("/app/notifications", session)}>Notifications</Link> to review delivery settings. A manual refresh confirms a
          fresh check only; it does not confirm recurring delivery. If a scheduled digest does not arrive, open a{" "}
          <Link to={appLinkTarget("/app/support?category=delivery", session)}>delivery support case</Link>.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Billing help">
        <p>
          Paid access follows the confirmed payment path connected to the account. When the hosted billing portal is
          available on <Link to={appLinkTarget("/app/billing", session)}>Plan &amp; billing</Link>, use it to cancel, change your card, or get
          invoices. When the portal is not available for your account, open a{" "}
          <Link to={appLinkTarget("/app/support?category=billing", session)}>signed-in support case</Link> for billing help.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Cancellation and deletion">
        <p>
          Cancellation stops future renewals, and access continues until the end of the period you have paid for.
          Use the hosted billing portal when it is available; otherwise, open a signed-in support case for cancellation
          help.
        </p>
        <p>
          Account deletion is a support request, not an automatic or in-app deletion. Signed-in customers can open a{" "}
          <Link to={appLinkTarget("/app/support?category=security", session)}>deletion support case</Link>; email{" "}
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you cannot sign in. Nothing is deleted automatically or
          in-app.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Paid customer support paths">
        <dl className="proof-trail-list">
          {CUSTOMER_SUPPORT_PATHS.map((path) => (
            <div key={path.label}>
              <dt>{path.label}</dt>
              <dd>{path.detail}</dd>
            </div>
          ))}
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Contact support">
        <p>
          Signed-in customers can open <Link to={appLinkTarget("/app/support", session)}>support cases</Link> for account access,
          billing changes, cancellation help, deletion requests, security reports, or migration
          support. Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you cannot sign in.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
