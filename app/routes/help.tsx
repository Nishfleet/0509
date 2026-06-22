import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { CUSTOMER_SUPPORT_PATHS } from "~/lib/agent-action-catalog";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

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
  return (
    <PublicDocShell
      kicker="Help"
      title="Get Five to Nine working for your team."
      intro="The fastest path is one competitor, one watchlist, one proof capture, then one delivery channel."
    >
      <PublicDocBlock title="Start here">
        <ol className="f9-numbered-guide">
          <li>Run a public search from the homepage or Search page.</li>
          <li>Create an account and add one competitor website.</li>
          <li>Open the watchlist and refresh tracking to capture the first proof trail.</li>
          <li>Review the digest page after the first monitored change or quiet check.</li>
        </ol>
      </PublicDocBlock>

      <PublicDocBlock title="Delivery setup">
        <p>
          Email delivery is available for eligible accounts. Slack delivery is self-serve from{" "}
          <Link to="/app/sources">Integrations</Link>: paste a Slack incoming webhook, save it, and future eligible
          digests can post there.
        </p>
        <p>
          WhatsApp delivery is not launch-scoped yet. Use email or Slack for customer delivery.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Billing help">
        <p>
          Plans and extra evidence-check packs use Dodo Payments. Signed-in customers can open the
          billing portal from <Link to="/app/billing">Plan &amp; billing</Link> when their account has
          a linked Dodo customer id. Plan changes and cancellation stay backed by{" "}
          <Link to="/app/support?category=billing">signed-in support cases</Link>.
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
          Signed-in customers can open <Link to="/app/support">support cases</Link> for account access,
          billing changes, cancellation help, deletion requests, security reports, or migration
          support. Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you cannot sign in.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
